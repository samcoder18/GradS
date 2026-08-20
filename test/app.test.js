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

function roadmapSnapshot() {
  const value = snapshot();
  value.tasks.push(
    {
      id: 'roadmap-0', position: 16, title: 'Собрать реквизиты', description: '', priority: null,
      track: 'roadmap', roadmap_stage: 0, roadmap_iteration: 2, completion_mode: 'manual', completed: true,
      created_by: 'Roadmap', created_at: '2026-08-20T08:00:00Z', updated_at: '2026-08-20T08:00:00Z', events: [], comments: [], audit_links: [],
    },
    {
      id: 'roadmap-1', position: 17, title: 'P0: форма офиса перестаёт врать про «заявку принята».', description: '', priority: null,
      track: 'roadmap', roadmap_stage: 1, roadmap_iteration: 1, completion_mode: 'derived', completed: false,
      created_by: 'Roadmap', created_at: '2026-08-20T08:00:00Z', updated_at: '2026-08-20T08:00:00Z', events: [], comments: [],
      audit_links: [{ id: 'task-1', title: 'Office form', priority: 'P0', completed: false }],
    },
    {
      id: 'roadmap-2', position: 18, title: 'Условия для опта', description: '', priority: null,
      track: 'roadmap', roadmap_stage: 2, roadmap_iteration: 1, completion_mode: 'manual', completed: false,
      created_by: 'Roadmap', created_at: '2026-08-20T08:00:00Z', updated_at: '2026-08-20T08:00:00Z', events: [], comments: [], audit_links: [],
    },
  );
  return value;
}

async function setup({ storedName = 'Ada', snapshotValue = snapshot(), apiOverride, reportText = reportMarkdown, roadmapText = '# Source roadmap\n\nRoadmap introduction.\n\n## Этапы\n\nПолный текст стратегии.' } = {}) {
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
    reportMarkdown: reportText,
    roadmapMarkdown: roadmapText,
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

  test('renders a separate roadmap workspace with stages, strategy, audit links, and contextual task creation', async () => {
    const { app, calls, dom } = await setup({ snapshotValue: roadmapSnapshot() });
    const { document } = dom.window;

    document.querySelector('[data-workspace-tab="roadmap"]').click();
    expect(document.querySelector('#roadmap-workspace').hidden).toBe(false);
    expect(document.querySelector('#audit-workspace').hidden).toBe(true);
    expect(document.querySelector('#roadmap-progress-percent').textContent).toBe('33%');
    expect(document.querySelectorAll('#roadmap-stage-list .roadmap-stage')).toHaveLength(9);
    expect(document.querySelector('#roadmap-stage-list').textContent).toContain('Этап 1');

    document.querySelector('#roadmap-board-comment').value = '  Общее обновление  ';
    document.querySelector('#roadmap-board-comment-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls).toContainEqual(['addBoardComment', { author: 'Ada', body: 'Общее обновление' }]);

    document.querySelector('[data-open-task="roadmap-1"]').click();
    expect(document.querySelector('#drawer-completed').disabled).toBe(true);
    expect(document.querySelector('#task-audit-links').textContent).toContain('Office form');

    document.querySelector('[data-create-roadmap-task][data-roadmap-stage="0"]').click();
    document.querySelector('#new-task-name').value = '  Подтвердить реквизиты  ';
    document.querySelector('#new-task-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls).toContainEqual(['createTask', {
      author: 'Ada', title: 'Подтвердить реквизиты', description: '', priority: null,
      track: 'roadmap', roadmapStage: 0, roadmapIteration: 2,
    }]);

    document.querySelector('#roadmap-strategy-tab').click();
    expect(document.querySelector('#roadmap-strategy').hidden).toBe(false);
    expect(document.querySelector('#roadmap-strategy-disclosures').textContent).toContain('Полный текст стратегии.');
    app.stop();
  });

  test('renders Markdown report content as safe semantic DOM without interpreting raw HTML', async () => {
    const semanticReport = [
      '# Semantic audit',
      '',
      '**Date:** `2026-08-20`',
      '',
      '## Findings',
      '',
      '### Evidence',
      '',
      'Read the [primary source](https://example.test/evidence) and keep <script>alert(1)</script> as text.',
      '',
      '- First bullet',
      '- Second **bold** bullet',
      '',
      '1. First action',
      '2. Second action',
      '',
      '> Quoted `runtime` evidence.',
      '',
      '| Area | Result |',
      '|---|---|',
      '| Access | Failed |',
    ].join('\n');
    const { app, dom } = await setup({ reportText: semanticReport });
    const { document } = dom.window;

    expect(document.querySelector('#report-introduction strong')?.textContent).toBe('Date:');
    expect(document.querySelector('#report-introduction code')?.textContent).toBe('2026-08-20');
    expect(document.querySelector('#report-introduction').textContent).not.toMatch(/\*\*|`/);
    expect(document.querySelector('#report-disclosures h2')?.textContent).toBe('Findings');
    expect(document.querySelector('#report-disclosures h3')?.textContent).toBe('Evidence');
    expect(document.querySelectorAll('#report-disclosures ul > li')).toHaveLength(2);
    expect(document.querySelectorAll('#report-disclosures ol > li')).toHaveLength(2);
    expect(document.querySelector('#report-disclosures blockquote')?.textContent).toContain('Quoted runtime evidence.');
    expect(document.querySelector('#report-disclosures table thead th')?.textContent).toBe('Area');
    expect(document.querySelector('#report-disclosures table tbody td')?.textContent).toBe('Access');
    expect(document.querySelector('#report-disclosures a')?.href).toBe('https://example.test/evidence');
    expect(document.querySelector('#report-disclosures script')).toBeNull();
    expect(document.querySelector('#report-disclosures').textContent).toContain('<script>alert(1)</script>');
    expect(document.querySelector('#report-disclosures pre')).toBeNull();
    app.stop();
  });

  test('renders every table and list from the checked-in audit report with HTML semantics', async () => {
    const fullReport = await readFile(new URL('../audit-report.md', import.meta.url), 'utf8');
    const { app, dom } = await setup({ reportText: fullReport });
    const { document } = dom.window;

    expect(document.querySelectorAll('#report-disclosures table')).toHaveLength(3);
    expect(document.querySelectorAll('#report-disclosures table thead')).toHaveLength(3);
    expect(document.querySelectorAll('#report-disclosures table tbody')).toHaveLength(3);
    expect(document.querySelectorAll('#report-disclosures ul')).not.toHaveLength(0);
    expect(document.querySelectorAll('#report-disclosures ol')).not.toHaveLength(0);
    expect(document.querySelectorAll('#report-disclosures h2')).toHaveLength(11);
    expect(document.querySelectorAll('#report-disclosures h3')).not.toHaveLength(0);
    expect(document.querySelectorAll('#report-introduction strong')).toHaveLength(4);
    expect(document.querySelector('#report-introduction code')).not.toBeNull();
    expect(document.querySelector('#report-introduction').textContent).not.toMatch(/\*\*|`/);
    expect(document.querySelector('#report-disclosures').textContent).not.toContain('|---|');
    expect(document.querySelector('#report-disclosures pre')).toBeNull();
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

  test('gives every completion checkbox a task-specific action label', async () => {
    const { app, dom } = await setup();
    const { document } = dom.window;
    const openTask = document.querySelector('[data-complete-task="task-1"]');
    const completedTask = document.querySelector('[data-complete-task="task-2"]');

    expect(openTask.getAttribute('aria-label')).toContain('<img src=x onerror=alert(1)> Keyboard map');
    expect(openTask.getAttribute('aria-label')).toContain('Отметить');
    expect(openTask.getAttribute('aria-label')).toContain('выполненной');
    expect(completedTask.getAttribute('aria-label')).toContain('Responsive images');
    expect(completedTask.getAttribute('aria-label')).toContain('Вернуть');
    expect(completedTask.getAttribute('aria-label')).toContain('в работу');

    document.querySelector('[data-open-task="task-1"]').click();
    expect(document.querySelector('#drawer-completed').getAttribute('aria-label')).toContain('Keyboard map');
    expect(document.querySelector('#drawer-completed').getAttribute('aria-label')).toContain('Отметить');
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
    expect(calls).toContainEqual(['createTask', {
      author: 'Ada', title: 'Follow up', description: 'Details', priority: 'P1',
      track: 'audit', roadmapStage: null, roadmapIteration: null,
    }]);

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

  test('shows a dedicated initialization error and permanently disables mutations', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'https://example.test/' });
    const interval = vi.fn();
    const app = appModule.createAuditApp({
      document: dom.window.document,
      window: dom.window,
      api: undefined,
      initializationError: {
        kind: 'invalid-link',
        message: 'В ссылке нет корректного токена доски.',
      },
      reportMarkdown,
      setIntervalFn: interval,
      clearIntervalFn: vi.fn(),
    });
    await app.start();
    const { document } = dom.window;

    expect(document.querySelector('#initialization-error').hidden).toBe(false);
    expect(document.querySelector('#initialization-error').dataset.state).toBe('invalid-link');
    expect(document.querySelector('#initialization-error').textContent).toContain('В ссылке нет корректного токена');
    expect(document.querySelector('#open-new-task').disabled).toBe(true);
    expect(document.querySelector('#board-comment').disabled).toBe(true);
    expect(document.querySelector('#board-comment-form button[type="submit"]').disabled).toBe(true);
    expect(document.querySelector('#drawer-completed').disabled).toBe(true);
    expect(interval).not.toHaveBeenCalled();

    document.querySelector('#board-comment').value = 'Must not send';
    document.querySelector('#board-comment-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    document.querySelector('#drawer-completed').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    expect(document.querySelector('#display-name-dialog').hasAttribute('open')).toBe(false);
    expect(document.querySelector('#app-status').textContent).toContain('В ссылке нет корректного токена');
    app.stop();
  });

  test('classifies missing token and invalid public configuration before creating an API', async () => {
    const loadConfig = vi.fn();
    const missingToken = await appModule.initializeBoardApi({ hash: '', loadConfig });
    expect(missingToken).toEqual({
      api: null,
      error: { kind: 'invalid-link', message: 'В ссылке нет корректного токена доски.' },
    });
    expect(loadConfig).not.toHaveBeenCalled();

    const invalidConfig = await appModule.initializeBoardApi({
      hash: '#board=abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG',
      loadConfig: async () => ({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }),
    });
    expect(invalidConfig).toEqual({
      api: null,
      error: { kind: 'configuration-error', message: 'Добавьте публичные настройки Supabase в src/config.js.' },
    });
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

  test('renders safe media, replies, reaction counts, and reply composer state', async () => {
    const boardSnapshot = snapshot();
    boardSnapshot.comments = [
      {
        id: 'comment-1',
        author: 'Ada',
        body: '<b>Keep it plain</b>',
        created_at: '2026-08-20T09:00:00Z',
        attachments: [],
        reactions: [{ emoji: '👍', count: 2, authors: ['Ada', 'Lin'] }],
      },
      {
        id: 'comment-2',
        parent_comment_id: 'comment-1',
        author: 'Lin',
        body: 'Reply with media',
        created_at: '2026-08-20T09:05:00Z',
        attachments: [{ type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', size: 120, url: 'https://cdn.example.test/photo.jpg' }],
        reactions: [],
      },
    ];
    const { app, dom } = await setup({ snapshotValue: boardSnapshot });
    const { document } = dom.window;

    expect(document.querySelectorAll('#board-comments [data-comment-id]')).toHaveLength(2);
    expect(document.querySelector('#board-comments img')?.alt).toBe('photo.jpg');
    expect(document.querySelector('#board-comments b')).toBeNull();
    expect(document.querySelector('[data-reaction-comment="comment-1"]')?.textContent).toBe('👍 2');

    document.querySelector('[data-reply-comment="comment-1"]').click();
    expect(document.querySelector('#board-reply').hidden).toBe(false);
    expect(document.querySelector('#board-reply-label').textContent).toContain('Ada');
    document.querySelector('[data-cancel-reply="board"]').click();
    expect(document.querySelector('#board-reply').hidden).toBe(true);
    app.stop();
  });

  test('supports fullscreen chat with Escape focus restoration and image drafts', async () => {
    const { app, dom } = await setup();
    const { document } = dom.window;
    const toggle = document.querySelector('#toggle-chat-fullscreen');

    toggle.click();
    expect(document.querySelector('.chat-panel').classList.contains('is-fullscreen')).toBe(true);
    expect(document.body.classList.contains('chat-is-fullscreen')).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    const file = new dom.window.File(['image'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(document.querySelector('#board-file-input'), 'files', { configurable: true, value: [file] });
    document.querySelector('#board-file-input').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(document.querySelectorAll('#board-attachment-drafts .attachment-draft')).toHaveLength(1);

    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.chat-panel').classList.contains('is-fullscreen')).toBe(false);
    expect(document.activeElement).toBe(toggle);
    app.stop();
  });

  test('uploads attachments before sending a reply through the new message API', async () => {
    const calls = [];
    const boardSnapshot = snapshot();
    boardSnapshot.comments = [{ id: 'comment-1', author: 'Ada', body: 'Original', created_at: '2026-08-20T09:00:00Z', attachments: [], reactions: [] }];
    const api = {
      snapshot: vi.fn(async () => structuredClone(boardSnapshot)),
      createTask: vi.fn(),
      setCompleted: vi.fn(),
      addTaskComment: vi.fn(),
      addBoardComment: vi.fn(),
      uploadMedia: vi.fn(async ({ file }) => ({ type: 'image', name: file.name, mimeType: file.type, size: file.size, path: 'p', url: 'https://cdn.example.test/p' })),
      addBoardMessage: vi.fn(async (values) => calls.push(values)),
      toggleReaction: vi.fn(),
    };
    const { app, dom } = await setup({ snapshotValue: boardSnapshot, apiOverride: api });
    const { document } = dom.window;
    document.querySelector('[data-reply-comment="comment-1"]').click();
    document.querySelector('#board-comment').value = 'With photo';
    const file = new dom.window.File(['image'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(document.querySelector('#board-file-input'), 'files', { configurable: true, value: [file] });
    document.querySelector('#board-file-input').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    document.querySelector('#board-comment-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();

    expect(api.uploadMedia).toHaveBeenCalledTimes(1);
    expect(calls).toContainEqual({
      author: 'Ada',
      body: 'With photo',
      parentCommentId: 'comment-1',
      attachments: [{ type: 'image', name: 'photo.png', mimeType: 'image/png', size: 5, path: 'p', url: 'https://cdn.example.test/p' }],
    });
    app.stop();
  });
});
