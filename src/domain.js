/**
 * Returns only the tasks visible under the selected board filters.
 * @param {Array<{priority: string, completed: boolean}>} tasks
 * @param {{priority?: string, status?: string}} filters
 */
export function filterTasks(tasks, { priority = 'all', status = 'all', search = '' } = {}) {
  const normalizedSearch = String(search).trim().toLocaleLowerCase();

  return tasks.filter((task) => {
    const priorityMatches = priority === 'all' || task.priority === priority;
    const statusMatches =
      status === 'all' ||
      (status === 'open' && !task.completed) ||
      (status === 'completed' && task.completed);
    const searchableText = `${task.title ?? ''} ${task.description ?? ''}`.toLocaleLowerCase();
    const searchMatches = !normalizedSearch || searchableText.includes(normalizedSearch);

    return priorityMatches && statusMatches && searchMatches;
  });
}

/**
 * Summarises completion for the whole audit board.
 * @param {Array<{completed: boolean}>} tasks
 */
export function auditProgress(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.completed).length;
  const open = total - completed;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return { total, completed, open, percent };
}

/**
 * Summarises progress for each fixed audit priority in display order.
 * @param {Array<{priority: string, completed: boolean}>} tasks
 */
export function priorityProgress(tasks) {
  return ['P0', 'P1', 'P2', 'P3'].map((priority) => {
    const priorityTasks = tasks.filter((task) => task.priority === priority);
    const { total, completed, percent } = auditProgress(priorityTasks);
    return { priority, total, completed, percent };
  });
}

/**
 * Validates a browser-only display name against the RPC contract.
 * @param {unknown} input
 */
export function normalizeDisplayName(input) {
  const value = String(input ?? '').trim().replace(/\s+/g, ' ');

  if (!value) {
    return { valid: false, error: 'Enter your display name.' };
  }

  if (value.length > 80) {
    return { valid: false, error: 'Use 80 characters or fewer.' };
  }

  return { valid: true, value };
}

/**
 * Validates an immutable task or board comment against the RPC contract.
 * @param {unknown} input
 */
export function normalizeComment(input) {
  const value = String(input ?? '').trim();

  if (!value) {
    return { valid: false, error: 'Enter a comment.' };
  }

  if (value.length > 4000) {
    return { valid: false, error: 'Use 4,000 characters or fewer.' };
  }

  return { valid: true, value };
}

const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const BOARD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Converts the new-task form values to the board's small public contract.
 * @param {{title?: unknown, priority?: unknown, track?: unknown, roadmapStage?: unknown, roadmapIteration?: unknown}} input
 */
export function normalizeTaskInput({
  title,
  priority = 'P1',
  track = 'audit',
  roadmapStage = null,
  roadmapIteration = null,
} = {}) {
  const normalizedTitle = String(title ?? '').trim().replace(/\s+/g, ' ');
  const normalizedPriority = String(priority).trim().toUpperCase();
  const normalizedTrack = String(track ?? '').trim().toLocaleLowerCase();
  const errors = {};

  if (!normalizedTitle) {
    errors.title = 'Enter a task title.';
  } else if (normalizedTitle.length > 200) {
    errors.title = 'Use 200 characters or fewer.';
  }

  if (normalizedTrack === 'roadmap') {
    const stage = Number(roadmapStage);
    const iteration = Number(roadmapIteration);
    const validIteration = (
      (stage === 0 && iteration === 2)
      || (stage === 1 && iteration === 1)
      || (stage === 2 && iteration >= 1 && iteration <= 3)
      || ([3, 4, 5, 6, 7].includes(stage) && iteration === 2)
      || (stage === 8 && iteration === 3)
    );
    if (!Number.isInteger(stage) || !Number.isInteger(iteration) || !validIteration) {
      errors.roadmap = 'Choose the stage context for this roadmap task.';
    }
  } else if (normalizedTrack !== 'audit') {
    errors.track = 'Choose the audit or roadmap workspace.';
  } else if (!PRIORITIES.has(normalizedPriority)) {
    errors.priority = 'Choose P0, P1, P2, or P3.';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  if (normalizedTrack === 'roadmap') {
    return {
      valid: true,
      value: {
        title: normalizedTitle,
        priority: null,
        track: 'roadmap',
        roadmapStage: Number(roadmapStage),
        roadmapIteration: Number(roadmapIteration),
      },
    };
  }

  return { valid: true, value: { title: normalizedTitle, priority: normalizedPriority } };
}

/**
 * Reads one URL-safe opaque board token from a location hash.
 * @param {unknown} fragment
 * @returns {string | null}
 */
export function parseBoardToken(fragment) {
  if (typeof fragment !== 'string') {
    return null;
  }

  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const tokens = params.getAll('board');

  if (tokens.length !== 1 || !BOARD_TOKEN_PATTERN.test(tokens[0])) {
    return null;
  }

  return tokens[0];
}
