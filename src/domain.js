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
 * @param {{title?: unknown, priority?: unknown}} input
 */
export function normalizeTaskInput({ title, priority = 'P1' } = {}) {
  const normalizedTitle = String(title ?? '').trim().replace(/\s+/g, ' ');
  const normalizedPriority = String(priority).trim().toUpperCase();
  const errors = {};

  if (!normalizedTitle) {
    errors.title = 'Enter a task title.';
  } else if (normalizedTitle.length > 200) {
    errors.title = 'Use 200 characters or fewer.';
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

export const MAX_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENTS = 5;
export const REACTION_OPTIONS = ['👍', '❤️', '🎉', '👀'];

/**
 * Converts File-like values into the safe metadata accepted by the message RPC.
 * The binary File itself deliberately stays outside the serializable message payload.
 * @param {Iterable<{name?: unknown, type?: unknown, size?: unknown}> | null | undefined} files
 */
export function normalizeAttachments(files) {
  const values = Array.from(files ?? []);
  if (values.length > MAX_CHAT_ATTACHMENTS) {
    return { valid: false, error: 'В одном сообщении можно отправить не больше 5 вложений.' };
  }

  const normalized = [];
  for (const file of values) {
    const mimeType = String(file?.type ?? '').trim().toLocaleLowerCase();
    const type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : null;
    if (!type) {
      return { valid: false, error: 'Прикреплять можно только изображения и аудио.' };
    }
    const size = Number(file?.size ?? 0);
    if (!Number.isFinite(size) || size < 0 || size > MAX_CHAT_ATTACHMENT_BYTES) {
      return { valid: false, error: 'Размер одного файла не должен превышать 8 МБ.' };
    }
    const name = String(file?.name ?? 'Вложение').trim().replace(/\s+/g, ' ') || 'Вложение';
    normalized.push({
      name: name.slice(0, 160),
      mimeType,
      size,
      type,
    });
  }

  return { valid: true, value: normalized };
}

/**
 * Keeps reply references opaque and prevents selector/path injection.
 * @param {unknown} input
 */
export function normalizeReplyId(input) {
  const value = String(input ?? '').trim();
  return /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : null;
}
