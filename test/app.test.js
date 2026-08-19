import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as appModule from '../src/app.js';

const reportMarkdown = '# Source audit\n\nEvidence introduction.\n\n## Summary\n\nFull report body.';

function snapshot() {
  return {
    board: { id: 'board-1', title: 'Audit board', created_at: '2026-08-20T08:00:00Z' },
    tasks: [
      {
        id: 'task-1',
        position: 1,
        title: '<img src=x onerror=alert(1)> Keyboard map',
        description: 'Make map controls focusable.',
        priority: 'P0',
        completed: false,
        created_by: 'Seed',
        created_at: '2026-08-20T08:00:00Z',
        updated_at: '2026-08-20T08:00:00Z',
        events: [
          { id: 'event-1', event_type: 'created', actor: 'Seed', from_completed: null, to_completed: false, created_at: '2026-08-20T08:00:00Z' },
        ],
        comments: [
          { id: 'comment-1', author: 'Ada', body: '<b>Keep this plain</b>', created_at: '2026-08-20T09:00:00Z' },
        ],
      },
      {
        id: 'task-2',
        position: 2,
        title: 'Responsive images',
        description: 'Reduce initial payload.',
        priority: 'P1',
        completed: true,
        created_by: 'Seed',
        created_at: '2026-08-20T08:00:00Z',
        updated_at: '2026-08-20T10:00:00Z',
        events: [],
        comments: [],
      },
    ],
    comments: [
      { id: 'board-comment-1', author: 'Lin', body: 'Board-wide note', created_at: '2026-08-20T09:00:00Z' },
    ],
  };
}

async function setup({ storedName = 'Ada', snapshotValue = snapshot() } = {}) {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.test/#board=abcdefghijklmnopqrstuvwxyz123456' });
  if (storedName) dom.window.localStorage.setItem('audit-tracker-display-name', storedName);
  const calls = [];
  const api = {
    snapshot: vi.fn(async () => structuredClone(snapshotValue)),
    createTask: vi.fn(async (values) => calls.push(['createTask', values])),
    setCompleted: vi.fn(async (values) => calls.push(['setCompleted', values])),
    addTaskComment: vi.fn(async (values) => calls.push(['addTaskComment', values])),
    addBoardComment: vi.fn(async (values) => calls.push(['addBoardComment', values])),
  };
  let intervalCallback;
  const app = appModule.createAuditApp({
    document: dom.window.document,
    window: dom.window,
    api,
    reportMarkdown,
    setIntervalFn(callback, delay) {
      intervalCallback = callback;
      expect(delay).toBe(20_000);
      return 1;
    },
    clearIntervalFn: vi.fn(),
  });
  await app.start();
  return { app, api, calls, dom, intervalCallback };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('audit tracker DOM client', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('renders progress, filters, report disclosures, and user content as plain text', async () => {
    const { app, dom } = await setup();
    const { document } = dom.window;

    expect(document.querySelector('#progress-percent').textContent).toBe('50%');
    expect(document.querySelectorAll('.task-card')).toHaveLength(2);
    expect(document.querySelector('#task-list img')).toBeNull();
    expect(document.querySelector('#task-list').textContent).toContain('<img src=x onerror=alert(1)>');

    const search = document.querySelector('#task-search');
    search.value = 'responsive';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(document.querySelectorAll('.task-card')).toHaveLength(1);
    expect(document.querySelector('.task-card').textContent).toContain('Responsive images');

    document.querySelector('#report-tab').click();
    expect(document.querySelector('#report').hidden).toBe(false);
    expect(document.querySelectorAll('#report-disclosures details')).toHaveLength(1);
    expect(document.querySelector('#report-disclosures').textContent).toContain('Full report body.');

    app.stop();
  });

  test('keeps the capability token in the URL when navigating report sections', async () => {
    const { app, dom } = await setup();
    const { document } = dom.window;
    const originalHash = dom.window.location.hash;

    document.querySelector('#report-tab').click();
    document.querySelector('#report-navigation a').click();
    await settle();

    expect(dom.window.location.hash).toBe(originalHash);
    expect(document.querySelector('#report-disclosures details').open).toBe(true);
    app.stop();
  });

  test('opens task details and refreshes after an exact completion mutation', async () => {
    const { app, api, calls, dom } = await setup();
    const { document } = dom.window;

    document.querySelector('[data-open-task="task-1"]').click();
    expect(document.querySelector('#task-drawer').hasAttribute('open')).toBe(true);
    expect(document.querySelector('#task-comments').textContent).toContain('<b>Keep this plain</b>');
    expect(document.querySelector('#task-comments b')).toBeNull();

    const checkbox = document.querySelector('[data-complete-task="task-1"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();

    expect(calls).toContainEqual(['setCompleted', { author: 'Ada', taskId: 'task-1', completed: true }]);
    expect(api.snapshot).toHaveBeenCalledTimes(2);
    app.stop();
  });

  test('requires and locally retains a display name before the first mutation', async () => {
    const { app, calls, dom } = await setup({ storedName: '' });
    const { document } = dom.window;
    const checkbox = document.querySelector('[data-complete-task="task-1"]');

    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    expect(document.querySelector('#display-name-dialog').hasAttribute('open')).toBe(true);
    expect(calls).toHaveLength(0);

    document.querySelector('#display-name').value = '  Grace Hopper  ';
    document.querySelector('#display-name-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    expect(dom.window.localStorage.getItem('audit-tracker-display-name')).toBe('Grace Hopper');
    expect(calls).toContainEqual(['setCompleted', { author: 'Grace Hopper', taskId: 'task-1', completed: true }]);
    app.stop();
  });

  test('cancels the pending mutation when Escape dismisses the display-name dialog', async () => {
    const { app, calls, dom } = await setup({ storedName: '' });
    const { document } = dom.window;
    const checkbox = document.querySelector('[data-complete-task="task-1"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();

    document.querySelector('#display-name-dialog').dispatchEvent(new dom.window.Event('cancel', { bubbles: true, cancelable: true }));
    await settle();

    expect(document.querySelector('#display-name-dialog').hasAttribute('open')).toBe(false);
    expect(document.querySelector('[data-complete-task="task-1"]').checked).toBe(false);
    expect(calls).toHaveLength(0);
    app.stop();
  });

  test('closes fallback dialogs with Escape when native showModal is unavailable', async () => {
    const { app, dom } = await setup();
    const { document } = dom.window;
    document.querySelector('#open-new-task').click();
    expect(document.querySelector('#new-task-dialog').hasAttribute('open')).toBe(true);

    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.querySelector('#new-task-dialog').hasAttribute('open')).toBe(false);
    app.stop();
  });

  test('refreshes on page focus and the 20-second polling callback', async () => {
    const { app, api, dom, intervalCallback } = await setup();

    dom.window.dispatchEvent(new dom.window.Event('focus'));
    await settle();
    expect(api.snapshot).toHaveBeenCalledTimes(2);

    await intervalCallback();
    expect(api.snapshot).toHaveBeenCalledTimes(3);
    app.stop();
  });

  test('submits P1-default tasks and immutable task and board comments through the public API', async () => {
    const { app, calls, dom } = await setup();
    const { document } = dom.window;

    document.querySelector('#open-new-task').click();
    document.querySelector('#new-task-name').value = '  Follow up  ';
    document.querySelector('#new-task-description').value = 'Details';
    document.querySelector('#new-task-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls).toContainEqual(['createTask', { author: 'Ada', title: 'Follow up', description: 'Details', priority: 'P1' }]);

    document.querySelector('#board-comment').value = '  Team update  ';
    document.querySelector('#board-comment-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls).toContainEqual(['addBoardComment', { author: 'Ada', body: 'Team update' }]);

    document.querySelector('[data-open-task="task-1"]').click();
    document.querySelector('#task-comment').value = '  Task note  ';
    document.querySelector('#task-comment-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls).toContainEqual(['addTaskComment', { author: 'Ada', taskId: 'task-1', body: 'Task note' }]);
    expect(document.querySelectorAll('[data-edit-comment], [data-delete-comment]')).toHaveLength(0);
    app.stop();
  });

  test('shows useful empty and loading-error states', async () => {
    const empty = { board: { id: 'board-1' }, tasks: [], comments: [] };
    const { app, dom } = await setup({ snapshotValue: empty });
    expect(dom.window.document.querySelector('#task-list').textContent).toContain('Нет задач');
    app.stop();

    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const errorDom = new JSDOM(html, { url: 'https://example.test/#board=abcdefghijklmnopqrstuvwxyz123456' });
    const errorApp = appModule.createAuditApp({
      document: errorDom.window.document,
      window: errorDom.window,
      api: { snapshot: async () => { throw new Error('Network unavailable'); } },
      reportMarkdown,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
    });
    await errorApp.start();
    expect(errorDom.window.document.querySelector('#app-status').textContent).toContain('Network unavailable');
    errorApp.stop();
  });
});
