import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as appModule from '../src/app.js';

function roadmapSnapshot() {
  return {
    board: { id: 'board-1', title: 'Roadmap board', created_at: '2026-08-20T08:00:00Z' },
    tasks: [
      {
        id: 'audit-hidden', track: 'audit', position: 1, title: 'Keyboard map', description: 'legacy audit', priority: 'P0',
        completed: false, created_at: '2026-08-20T08:00:00Z', updated_at: '2026-08-20T08:00:00Z', events: [], comments: [],
      },
      {
        id: 'roadmap-0', track: 'roadmap', position: 16, title: '<img src=x onerror=alert(1)> Реквизиты', description: '', priority: null,
        roadmap_stage: 0, roadmap_iteration: 2, completion_mode: 'manual', completed: true,
        created_at: '2026-08-20T08:00:00Z', updated_at: '2026-08-20T08:00:00Z', events: [], comments: [], audit_links: [],
      },
      {
        id: 'roadmap-1', track: 'roadmap', position: 17, title: 'Форма офиса', description: 'Сделать отправку формы понятной.', priority: null,
        roadmap_stage: 1, roadmap_iteration: 1, completion_mode: 'manual', completed: false,
        created_at: '2026-08-20T08:00:00Z', updated_at: '2026-08-20T08:00:00Z', events: [], comments: [], audit_links: [],
      },
      {
        id: 'roadmap-2', track: 'roadmap', position: 18, title: 'Условия для опта', description: '', priority: null,
        roadmap_stage: 2, roadmap_iteration: 1, completion_mode: 'manual', completed: false,
        created_at: '2026-08-20T08:00:00Z', updated_at: '2026-08-20T08:00:00Z', events: [],
        comments: [{ id: 'task-comment-1', author: 'Lin', body: '<b>Обсудить условия</b>', created_at: '2026-08-20T09:00:00Z' }], audit_links: [],
      },
    ],
    comments: [{ id: 'board-comment-1', author: 'Ada', body: '<b>Общее сообщение</b>', created_at: '2026-08-20T09:00:00Z' }],
  };
}

async function setup({ storedName = 'Ada', snapshotValue = roadmapSnapshot(), apiOverride, initializationError = null } = {}) {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.test/#board=abcdefghijklmnopqrstuvwxyz123456' });
  if (storedName) dom.window.localStorage.setItem('audit-tracker-display-name', storedName);
  const calls = [];
  const api = apiOverride ?? {
    snapshot: vi.fn(async () => structuredClone(snapshotValue)),
    createTask: vi.fn(async (value) => calls.push(['createTask', value])),
    setCompleted: vi.fn(async (value) => calls.push(['setCompleted', value])),
    addTaskComment: vi.fn(async (value) => calls.push(['addTaskComment', value])),
    addBoardComment: vi.fn(async (value) => calls.push(['addBoardComment', value])),
  };
  let intervalCallback;
  const app = appModule.createAuditApp({
    document: dom.window.document,
    window: dom.window,
    api: initializationError ? null : api,
    initializationError,
    roadmapMarkdown: '# Стратегия\n\nВводный текст.\n\n## Этапы\n\n*Обычный* **безопасный** текст.\n\n## Следующие шаги\n\n1. Первая задача',
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

describe('roadmap-only DOM client', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('shows only roadmap tasks when a legacy audit record is present', async () => {
    const { app, dom } = await setup();
    const { document } = dom.window;

    expect(document.querySelector('.workspace-tabs')).toBeNull();
    expect(document.querySelector('#audit-workspace')).toBeNull();
    expect(document.querySelector('#report')).toBeNull();
    expect(document.querySelectorAll('#roadmap-stage-list .task-card')).toHaveLength(3);
    expect(document.querySelector('#roadmap-stage-list').textContent).not.toContain('Keyboard map');
    expect(document.querySelector('#roadmap-progress-percent').textContent).toBe('33%');
    expect(document.querySelector('#roadmap-stage-list img')).toBeNull();
    expect(document.querySelector('#roadmap-stage-list').textContent).toContain('<img src=x onerror=alert(1)>');
    app.stop();
  });

  test('filters roadmap stages and statuses without leaving the workspace', async () => {
    const { app, dom } = await setup();
    const { document } = dom.window;
    const stage = document.querySelector('#roadmap-stage-filter');
    const status = document.querySelector('#roadmap-status-filter');

    stage.value = '1';
    stage.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(document.querySelectorAll('#roadmap-stage-list .task-card')).toHaveLength(1);
    expect(document.querySelector('#roadmap-stage-list').textContent).toContain('Форма офиса');
    status.value = 'completed';
    status.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(document.querySelectorAll('#roadmap-stage-list .task-card')).toHaveLength(0);
    app.stop();
  });

  test('keeps every roadmap task actionable and saves completion with the owner name', async () => {
    const { app, calls, dom } = await setup();
    const { document } = dom.window;

    document.querySelector('[data-open-task="roadmap-1"]').click();
    const checkbox = document.querySelector('#drawer-completed');
    expect(checkbox.disabled).toBe(false);
    expect(document.querySelector('#task-audit-links-section')).toBeNull();
    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    await settle();

    expect(calls).toContainEqual(['setCompleted', { author: 'Ada', taskId: 'roadmap-1', completed: true }]);
    app.stop();
  });

  test('asks for and retains a display name before a roadmap mutation', async () => {
    const { app, calls, dom } = await setup({ storedName: '' });
    const { document } = dom.window;
    const checkbox = document.querySelector('[data-complete-task="roadmap-1"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    expect(document.querySelector('#display-name-dialog').hasAttribute('open')).toBe(true);

    document.querySelector('#display-name').value = '  Маша  ';
    document.querySelector('#display-name-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    expect(calls).toContainEqual(['setCompleted', { author: 'Маша', taskId: 'roadmap-1', completed: true }]);
    expect(dom.window.localStorage.getItem('audit-tracker-display-name')).toBe('Маша');
    app.stop();
  });

  test('creates a task in the selected stage with no audit priority', async () => {
    const { app, calls, dom } = await setup();
    const { document } = dom.window;
    const add = document.querySelector('[data-create-roadmap-task][data-roadmap-stage="2"][data-roadmap-iteration="1"]');
    add.click();
    document.querySelector('#new-task-name').value = 'Новая задача';
    document.querySelector('#new-task-description').value = 'Короткое описание';
    document.querySelector('#new-task-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();

    expect(calls).toContainEqual(['createTask', {
      author: 'Ada', title: 'Новая задача', description: 'Короткое описание', priority: null,
      track: 'roadmap', roadmapStage: 2, roadmapIteration: 1,
    }]);
    app.stop();
  });

  test('renders the strategy as safe semantic content and retains the secret fragment while navigating', async () => {
    const { app, dom } = await setup();
    const { document } = dom.window;
    document.querySelector('#roadmap-strategy-tab').click();

    expect(document.querySelector('#roadmap-strategy').hidden).toBe(false);
    expect(document.querySelectorAll('#roadmap-strategy-disclosures details')).toHaveLength(2);
    expect(document.querySelector('#roadmap-strategy-disclosures strong')?.textContent).toBe('безопасный');
    expect(dom.window.location.hash).toBe('#board=abcdefghijklmnopqrstuvwxyz123456');
    app.stop();
  });

  test('expands and collapses every strategy section through the action buttons', async () => {
    const { app, dom } = await setup();
    const { document } = dom.window;
    document.querySelector('#roadmap-strategy-tab').click();
    const sections = [...document.querySelectorAll('#roadmap-strategy-disclosures details')];

    document.querySelector('#expand-roadmap-strategy').click();
    expect(sections.every((section) => section.open)).toBe(true);
    expect(sections.every((section) => section.classList.contains('is-opening'))).toBe(true);

    document.querySelector('#collapse-roadmap-strategy').click();
    expect(sections.every((section) => section.classList.contains('is-closing'))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(sections.every((section) => !section.open)).toBe(true);
    app.stop();
  });

  test('sends immutable task and board comments as plain text', async () => {
    const { app, calls, dom } = await setup();
    const { document } = dom.window;
    expect(document.querySelector('#board-comments b')).toBeNull();

    document.querySelector('#board-comment').value = 'Общий ответ';
    document.querySelector('#board-comment-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    document.querySelector('[data-open-task="roadmap-2"]').click();
    document.querySelector('#task-comment').value = 'Комментарий к задаче';
    document.querySelector('#task-comment-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();

    expect(calls).toContainEqual(['addBoardComment', { author: 'Ada', body: 'Общий ответ' }]);
    expect(calls).toContainEqual(['addTaskComment', { author: 'Ada', taskId: 'roadmap-2', body: 'Комментарий к задаче' }]);
    app.stop();
  });

  test('refreshes on focus and every 20 seconds without an audit view', async () => {
    const { app, api, dom, intervalCallback } = await setup();
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    await settle();
    await intervalCallback();
    expect(api.snapshot).toHaveBeenCalledTimes(3);
    app.stop();
  });

  test('shows a Roadmap-specific unavailable state and blocks mutations for an invalid link', async () => {
    const { app, dom } = await setup({
      initializationError: { kind: 'invalid-link', message: 'В ссылке нет корректного токена доски.' },
    });
    const { document } = dom.window;
    expect(document.querySelector('#initialization-error').hidden).toBe(false);
    expect(document.querySelector('#roadmap-stage-list').textContent).toContain('roadmap-доска недоступна');
    expect(document.querySelector('#board-comment').disabled).toBe(true);
    expect(document.querySelector('#drawer-completed').disabled).toBe(true);
    app.stop();
  });

  test('classifies missing token and invalid public configuration before creating an API', async () => {
    const loadConfig = vi.fn();
    await expect(appModule.initializeBoardApi({ hash: '', loadConfig })).resolves.toEqual({
      api: null,
      error: { kind: 'invalid-link', message: 'В ссылке нет корректного токена доски.' },
    });
    expect(loadConfig).not.toHaveBeenCalled();
    await expect(appModule.initializeBoardApi({
      hash: '#board=abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG',
      loadConfig: async () => ({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }),
    })).resolves.toEqual({
      api: null,
      error: { kind: 'configuration-error', message: 'Добавьте публичные настройки Supabase в src/config.js.' },
    });
  });
});
