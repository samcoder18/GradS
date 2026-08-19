import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  auditProgress,
  filterTasks,
  normalizeTaskInput,
  parseBoardToken,
} from '../src/domain.js';
import * as domain from '../src/domain.js';
import {
  ROADMAP_ITERATIONS,
  ROADMAP_STAGES,
  filterRoadmapTasks,
  roadmapProgress,
  roadmapStageGroups,
} from '../src/roadmap.js';

describe('filterTasks', () => {
  test('keeps tasks matching the selected priority and completion state', () => {
    const tasks = [
      { id: 'a', priority: 'P0', completed: false },
      { id: 'b', priority: 'P1', completed: true },
      { id: 'c', priority: 'P1', completed: false },
    ];

    expect(filterTasks(tasks, { priority: 'P1', status: 'open' })).toEqual([
      { id: 'c', priority: 'P1', completed: false },
    ]);
  });

  test('treats an all filter as unrestricted', () => {
    const tasks = [{ id: 'a', priority: 'P0', completed: false }];

    expect(filterTasks(tasks, { priority: 'all', status: 'all' })).toEqual(tasks);
  });

  test('matches a case-insensitive search across task titles and descriptions', () => {
    const tasks = [
      { id: 'a', title: 'Keyboard navigation', description: 'Fix the map', priority: 'P1', completed: false },
      { id: 'b', title: 'Image loading', description: 'Responsive bottles', priority: 'P1', completed: false },
    ];

    expect(filterTasks(tasks, { search: '  MAP  ' })).toEqual([tasks[0]]);
  });
});

describe('priorityProgress', () => {
  test('reports stable P0 through P3 totals and percentages, including empty priorities', () => {
    const tasks = [
      { priority: 'P0', completed: true },
      { priority: 'P0', completed: false },
      { priority: 'P2', completed: true },
    ];

    expect(domain.priorityProgress(tasks)).toEqual([
      { priority: 'P0', total: 2, completed: 1, percent: 50 },
      { priority: 'P1', total: 0, completed: 0, percent: 0 },
      { priority: 'P2', total: 1, completed: 1, percent: 100 },
      { priority: 'P3', total: 0, completed: 0, percent: 0 },
    ]);
  });
});

describe('visitor input normalization', () => {
  test('trims display names and comments while enforcing the public RPC bounds', () => {
    expect(domain.normalizeDisplayName('  Ada Lovelace  ')).toEqual({ valid: true, value: 'Ada Lovelace' });
    expect(domain.normalizeDisplayName('   ')).toEqual({ valid: false, error: 'Enter your display name.' });
    expect(domain.normalizeComment('  Ship it.  ')).toEqual({ valid: true, value: 'Ship it.' });
    expect(domain.normalizeComment('   ')).toEqual({ valid: false, error: 'Enter a comment.' });
  });
});

describe('auditProgress', () => {
  test('reports total, completed, open, and rounded completion percent', () => {
    const result = auditProgress([
      { completed: true },
      { completed: false },
      { completed: true },
    ]);

    expect(result).toEqual({ total: 3, completed: 2, open: 1, percent: 67 });
  });

  test('reports zero percent for an empty board', () => {
    expect(auditProgress([])).toEqual({ total: 0, completed: 0, open: 0, percent: 0 });
  });
});

describe('normalizeTaskInput', () => {
  test('trims a title, collapses its whitespace, and normalizes the priority', () => {
    expect(normalizeTaskInput({ title: '  Review\n  keyboard\t flow  ', priority: 'p2' })).toEqual({
      valid: true,
      value: { title: 'Review keyboard flow', priority: 'P2' },
    });
  });

  test('uses P1 when priority is omitted', () => {
    expect(normalizeTaskInput({ title: 'Add audit task' })).toEqual({
      valid: true,
      value: { title: 'Add audit task', priority: 'P1' },
    });
  });

  test('rejects a blank title and an unsupported priority', () => {
    expect(normalizeTaskInput({ title: '   ', priority: 'urgent' })).toEqual({
      valid: false,
      errors: { title: 'Enter a task title.', priority: 'Choose P0, P1, P2, or P3.' },
    });
  });

  test('rejects a task title longer than the public RPC limit', () => {
    expect(normalizeTaskInput({ title: 'x'.repeat(201), priority: 'P1' })).toEqual({
      valid: false,
      errors: { title: 'Use 200 characters or fewer.' },
    });
  });

  test('normalizes roadmap work without a priority and requires its stage context', () => {
    expect(normalizeTaskInput({
      title: '  Собрать материалы  ',
      track: 'roadmap',
      roadmapStage: 2,
      roadmapIteration: 3,
    })).toEqual({
      valid: true,
      value: {
        title: 'Собрать материалы',
        priority: null,
        track: 'roadmap',
        roadmapStage: 2,
        roadmapIteration: 3,
      },
    });
    expect(normalizeTaskInput({ title: 'Без контекста', track: 'roadmap', roadmapStage: 0, roadmapIteration: 1 }))
      .toEqual({ valid: false, errors: { roadmap: 'Choose the stage context for this roadmap task.' } });
  });
});

describe('roadmap task grouping', () => {
  const roadmapTasks = [
    { id: 'stage-0', track: 'roadmap', roadmap_stage: 0, roadmap_iteration: 2, title: 'Реквизиты', completed: true },
    { id: 'stage-2-fast', track: 'roadmap', roadmap_stage: 2, roadmap_iteration: 1, title: 'Форма', completed: false },
    { id: 'stage-2-growth', track: 'roadmap', roadmap_stage: 2, roadmap_iteration: 3, title: 'Квиз', completed: false },
    { id: 'audit', track: 'audit', priority: 'P0', title: 'Аудит', completed: false },
  ];

  test('filters only roadmap tasks by search, completion, and stage without mixing audit work', () => {
    expect(filterRoadmapTasks(roadmapTasks, { stage: '2', status: 'open', search: '  ФОРМА ' }))
      .toEqual([roadmapTasks[1]]);
  });

  test('reports overall and stable iteration progress for roadmap tasks', () => {
    expect(roadmapProgress(roadmapTasks)).toEqual({ total: 3, completed: 1, open: 2, percent: 33 });
    expect(ROADMAP_ITERATIONS.map(({ iteration, title }) => ({ iteration, title }))).toEqual([
      { iteration: 1, title: 'Быстрые деньги' },
      { iteration: 2, title: 'Доверие и запуск' },
      { iteration: 3, title: 'Рост' },
    ]);
  });

  test('keeps all nine source stages and separates the three stage-two iteration groups', () => {
    expect(ROADMAP_STAGES).toHaveLength(9);
    expect(roadmapStageGroups(roadmapTasks, 2)).toEqual([
      { iteration: 1, tasks: [roadmapTasks[1]] },
      { iteration: 2, tasks: [] },
      { iteration: 3, tasks: [roadmapTasks[2]] },
    ]);
  });
});

describe('parseBoardToken', () => {
  const token = 'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M';

  test('returns an opaque board token from the fragment query', () => {
    expect(parseBoardToken(`#board=${token}`)).toBe(token);
  });

  test('rejects missing, duplicate, or malformed fragment tokens', () => {
    expect(parseBoardToken('#view=board')).toBeNull();
    expect(parseBoardToken(`#board=${token}&board=${token}`)).toBeNull();
    expect(parseBoardToken('#board=%3Cscript%3E')).toBeNull();
    expect(parseBoardToken('#board=short')).toBeNull();
  });

  test('accepts only the provisioner\'s exact 43-character base64url token length', () => {
    expect(parseBoardToken(`#board=${'a'.repeat(43)}`)).toBe('a'.repeat(43));
    expect(parseBoardToken(`#board=${'a'.repeat(42)}`)).toBeNull();
    expect(parseBoardToken(`#board=${'a'.repeat(44)}`)).toBeNull();
  });
});

describe('static app foundation', () => {
  test('provides semantic landmarks and announced application status', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const document = new JSDOM(html).window.document;

    expect(document.querySelector('header')).not.toBeNull();
    expect(document.querySelector('main')).not.toBeNull();
    expect(document.querySelector('nav[aria-label="Рабочее пространство"]')).not.toBeNull();
    expect(document.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });

  test('publishes only public configuration placeholders', async () => {
    const config = await readFile(new URL('../src/config.example.js', import.meta.url), 'utf8');

    expect(config).toContain('SUPABASE_ANON_KEY');
    expect(config).not.toMatch(/service[_-]?role/i);
  });

  test('provides accessible audit and roadmap workspaces, source documents, and task controls', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const document = new JSDOM(html).window.document;

    expect(document.querySelector('[role="tablist"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-workspace-tab]')).toHaveLength(2);
    expect(document.querySelector('#roadmap-workspace')).not.toBeNull();
    expect(document.querySelector('#roadmap-tracker')).not.toBeNull();
    expect(document.querySelector('#roadmap-strategy')).not.toBeNull();
    expect(document.querySelector('#roadmap-stage-list')).not.toBeNull();
    expect(document.querySelector('#roadmap-iteration-progress')).not.toBeNull();
    expect(document.querySelector('#roadmap-search')).not.toBeNull();
    expect(document.querySelector('#roadmap-status-filter')).not.toBeNull();
    expect(document.querySelector('#task-search')).not.toBeNull();
    expect(document.querySelector('#priority-filter')).not.toBeNull();
    expect(document.querySelector('#status-filter')).not.toBeNull();
    expect(document.querySelector('#new-task-dialog form')).not.toBeNull();
    expect(document.querySelector('#display-name-dialog form')).not.toBeNull();
    expect(document.querySelector('#task-drawer[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('#board-comment-form')).not.toBeNull();
    expect(document.querySelector('#report-disclosures')).not.toBeNull();
  });
});
