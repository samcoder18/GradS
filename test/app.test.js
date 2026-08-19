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

async function setup({ storedName = 'Ada', snapshotValue = snapshot(), apiOverride } = {}) {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.test/#board=abcdefghijklmnopqrstuvwxyz123456' });
  if (storedName) dom.window.localStorage.setItem('audit-tracker-display-name', storedName);
  const calls = [];
  const api = apiOverride ?? {
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

  test('keeps the capability token for skip, brand, and report navigation', async () => {
    const { app, dom } = await setup();
    const { document } = dom.window;
    const originalHash = dom.window.location.hash;

    const skipEvent = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('.skip-link').dispatchEvent(skipEvent);
    await settle();
    expect(skipEvent.defaultPrevented).toBe(true);
    expect(dom.window.location.hash).toBe(originalHash);
    expect(document.activeElement).toBe(document.querySelector('#main-content'));

    document.querySelector('#report-tab').click();
    document.querySelector('#report-navigation a').click();
    await settle();

    expect(dom.window.location.hash).toBe(originalHash);
    expect(document.querySelector('#report-disclosures details').open).toBe(true);

    const brandEvent = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('.brand').dispatchEvent(brandEvent);
    await settle();
    expect(brandEvent.defaultPrevented).toBe(true);
    expect(dom.window.location.hash).toBe(originalHash);
    expect(document.querySelector('#tracker-tab').getAttribute('aria-selected')).toBe('true');
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
    const opener = document.querySelector('#open-new-task');
    opener.focus();
    opener.click();
    await settle();
    expect(document.querySelector('#new-task-dialog').hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#new-task-name'));

    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.querySelector('#new-task-dialog').hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(opener);
    app.stop();
  });

  test('Escape cancels the topmost name gate and restores focus to the open drawer', async () => {
    const { app, calls, dom } = await setup({ storedName: '' });
    const { document } = dom.window;
    document.querySelector('[data-open-task="task-1"]').click();
    const drawerCheckbox = document.querySelector('#drawer-completed');
    drawerCheckbox.focus();
    drawerCheckbox.checked = true;
    drawerCheckbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();

    expect(document.querySelector('#task-drawer').hasAttribute('open')).toBe(true);
    expect(document.querySelector('#display-name-dialog').hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#display-name'));

    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();

    expect(document.querySelector('#display-name-dialog').hasAttribute('open')).toBe(false);
    expect(document.querySelector('#task-drawer').hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(drawerCheckbox);
    expect(calls).toHaveLength(0);
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

  test('keeps background refreshes and typing filters out of live announcements', async () => {
    const { app, dom, intervalCallback } = await setup();
    const { document } = dom.window;
    const status = document.querySelector('#app-status');
    status.textContent = 'Stable announcement';

    expect(document.querySelector('#task-list').hasAttribute('aria-live')).toBe(false);
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    await settle();
    expect(status.textContent).toBe('Stable announcement');

    await intervalCallback();
    expect(status.textContent).toBe('Stable announcement');

    const search = document.querySelector('#task-search');
    search.value = 'keyboard';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(status.textContent).toBe('Stable announcement');
    app.stop();
  });

  test('takes a fresh snapshot after a mutation even when an older refresh is in flight', async () => {
    const staleRefresh = deferred();
    const fresh = snapshot();
    fresh.tasks[0].completed = true;
    const api = {
      snapshot: vi.fn()
        .mockResolvedValueOnce(snapshot())
        .mockImplementationOnce(() => staleRefresh.promise)
        .mockResolvedValueOnce(fresh),
      createTask: vi.fn(),
      setCompleted: vi.fn(async () => ({})),
      addTaskComment: vi.fn(),
      addBoardComment: vi.fn(),
    };
    const { app, dom } = await setup({ apiOverride: api });
    const { document } = dom.window;

    dom.window.dispatchEvent(new dom.window.Event('focus'));
    await Promise.resolve();
    const checkbox = document.querySelector('[data-complete-task="task-1"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    expect(api.setCompleted).toHaveBeenCalledTimes(1);

    staleRefresh.resolve(snapshot());
    await settle();
    await settle();

    expect(api.snapshot).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[data-complete-task="task-1"]').checked).toBe(true);
    app.stop();
  });

  test('ignores a rejected stale poll and still refreshes after a successful mutation', async () => {
    const fresh = snapshot();
    fresh.tasks[0].completed = true;
    const api = {
      snapshot: vi.fn()
        .mockResolvedValueOnce(snapshot())
        .mockResolvedValueOnce(snapshot())
        .mockResolvedValueOnce(fresh),
      createTask: vi.fn(),
      setCompleted: vi.fn(async () => ({})),
      addTaskComment: vi.fn(),
      addBoardComment: vi.fn(),
    };
    const { app, dom, intervalCallback } = await setup({ apiOverride: api });
    const { document } = dom.window;
    const taskList = document.querySelector('#task-list');
    const setAttribute = taskList.setAttribute.bind(taskList);
    let rejectStalePoll = true;
    taskList.setAttribute = (name, value) => {
      if (rejectStalePoll && name === 'aria-busy' && value === 'false') {
        rejectStalePoll = false;
        throw new Error('Stale poll finalization failed');
      }
      setAttribute(name, value);
    };

    await expect(intervalCallback()).rejects.toThrow('Stale poll finalization failed');
    const checkbox = document.querySelector('[data-complete-task="task-1"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    await settle();

    expect(api.setCompleted).toHaveBeenCalledTimes(1);
    expect(api.snapshot).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[data-complete-task="task-1"]').checked).toBe(true);
    expect(document.querySelector('#app-status').textContent).toBe('Изменение сохранено.');
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

  test('locks mutation controls during a request and prevents duplicate immutable writes', async () => {
    const pendingComment = deferred();
    const api = {
      snapshot: vi.fn(async () => snapshot()),
      createTask: vi.fn(),
      setCompleted: vi.fn(),
      addTaskComment: vi.fn(),
      addBoardComment: vi.fn(() => pendingComment.promise),
    };
    const { app, dom } = await setup({ apiOverride: api });
    const { document } = dom.window;
    document.querySelector('#board-comment').value = 'One immutable note';
    const form = document.querySelector('#board-comment-form');

    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const controls = document.querySelectorAll(
      '#new-task-form button[type="submit"], #board-comment-form button[type="submit"], #task-comment-form button[type="submit"], [data-complete-task]',
    );
    expect([...controls].every((control) => control.disabled)).toBe(true);

    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(api.addBoardComment).toHaveBeenCalledTimes(1);

    pendingComment.resolve({});
    await settle();
    await settle();
    expect([...document.querySelectorAll('#new-task-form button[type="submit"], #board-comment-form button[type="submit"], #task-comment-form button[type="submit"], [data-complete-task]')].every((control) => !control.disabled)).toBe(true);
    app.stop();
  });

  test('re-enables mutation controls after a failed write', async () => {
    const pendingComment = deferred();
    const api = {
      snapshot: vi.fn(async () => snapshot()),
      createTask: vi.fn(),
      setCompleted: vi.fn(),
      addTaskComment: vi.fn(),
      addBoardComment: vi.fn(() => pendingComment.promise),
    };
    const { app, dom } = await setup({ apiOverride: api });
    const { document } = dom.window;
    document.querySelector('#board-comment').value = 'Will fail once';
    document.querySelector('#board-comment-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('#board-comment-form button[type="submit"]').disabled).toBe(true);

    pendingComment.reject(new Error('Write unavailable'));
    await settle();
    await settle();

    expect(document.querySelector('#board-comment-form button[type="submit"]').disabled).toBe(false);
    expect(document.querySelector('#app-status').textContent).toContain('Write unavailable');
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

  test('does not rebind local event listeners when the client restarts', async () => {
    const { app, dom } = await setup();
    const { document } = dom.window;
    app.stop();
    await app.start();
    const main = document.querySelector('#main-content');
    main.focus = vi.fn();

    document.querySelector('.skip-link').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(main.focus).toHaveBeenCalledTimes(1);
    app.stop();
  });
});
