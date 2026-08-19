/**
 * Returns only the tasks visible under the selected board filters.
 * @param {Array<{priority: string, completed: boolean}>} tasks
 * @param {{priority?: string, status?: string}} filters
 */
export function filterTasks(tasks, { priority = 'all', status = 'all' } = {}) {
  return tasks.filter((task) => {
    const priorityMatches = priority === 'all' || task.priority === priority;
    const statusMatches =
      status === 'all' ||
      (status === 'open' && !task.completed) ||
      (status === 'completed' && task.completed);

    return priorityMatches && statusMatches;
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

const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const BOARD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/**
 * Converts the new-task form values to the board's small public contract.
 * @param {{title?: unknown, priority?: unknown}} input
 */
export function normalizeTaskInput({ title, priority = 'P1' } = {}) {
  const normalizedTitle = String(title ?? '').trim().replace(/\s+/g, ' ');
  const normalizedPriority = String(priority).trim().toUpperCase();
  const errors = {};

  if (!normalizedTitle) {
    errors.title = 'Enter a task title.';
  }

  if (!PRIORITIES.has(normalizedPriority)) {
    errors.priority = 'Choose P0, P1, P2, or P3.';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: { title: normalizedTitle, priority: normalizedPriority },
  };
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
