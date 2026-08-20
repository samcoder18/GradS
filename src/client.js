function reportId(title, usedIds) {
  const base = title
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'section';
  let id = `report-${base}`;
  let suffix = 2;

  while (usedIds.has(id)) {
    id = `report-${base}-${suffix}`;
    suffix += 1;
  }

  usedIds.add(id);
  return id;
}

class SupabaseRpcError extends Error {
  constructor({ message, status, code, details, hint }) {
    super(message || `Supabase RPC failed with HTTP ${status}.`);
    this.name = 'SupabaseRpcError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

function safeStorageName(name) {
  return String(name || 'attachment')
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'attachment';
}

function mediaType(mimeType) {
  return String(mimeType || '').toLocaleLowerCase().startsWith('audio/') ? 'audio' : 'image';
}

/**
 * Minimal dependency-free browser adapter for Supabase's PostgREST RPC endpoint.
 * @param {{url: string, anonKey: string, fetchFn?: typeof fetch}} options
 */
export function createSupabaseRpcClient({ url, anonKey, fetchFn = globalThis.fetch }) {
  const baseUrl = new URL(url);
  if (baseUrl.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS.');
  if (!anonKey) throw new Error('SUPABASE_ANON_KEY is required.');
  if (typeof fetchFn !== 'function') throw new Error('This browser cannot send Supabase requests.');

  async function upload({ token, file }) {
    const fileName = String(file?.name || 'attachment');
    const randomPart = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const path = `${token}/${randomPart}-${safeStorageName(fileName)}`;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const endpoint = new URL(`/storage/v1/object/audit-media/${encodedPath}`, baseUrl);
    const response = await fetchFn(endpoint.href, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        'Content-Type': file?.type || 'application/octet-stream',
        'x-upsert': 'false',
      },
      body: file,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Storage errors can be empty; the HTTP status still remains useful.
    }
    if (!response.ok) {
      throw new SupabaseRpcError({
        message: payload?.message || `Supabase Storage failed with HTTP ${response.status}.`,
        status: response.status,
        code: payload?.statusCode || payload?.code,
        details: payload?.error,
        hint: null,
      });
    }

    const publicPath = path.split('/').map(encodeURIComponent).join('/');
    return {
      type: mediaType(file?.type),
      name: fileName,
      mimeType: file?.type || 'application/octet-stream',
      size: Number(file?.size || 0),
      path,
      url: new URL(`/storage/v1/object/public/audit-media/${publicPath}`, baseUrl).href,
    };
  }

  return {
    async rpc(name, args) {
      const endpoint = new URL(`/rest/v1/rpc/${encodeURIComponent(name)}`, baseUrl);
      const response = await fetchFn(endpoint.href, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          apikey: anonKey,
        },
        body: JSON.stringify(args),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // PostgREST errors are normally JSON; preserve an actionable fallback otherwise.
      }
      if (!response.ok) {
        return {
          data: null,
          error: new SupabaseRpcError({
            message: payload?.message,
            status: response.status,
            code: payload?.code,
            details: payload?.details,
            hint: payload?.hint,
          }),
        };
      }
      return { data: payload, error: null };
    },
    upload,
  };
}

/**
 * Splits the immutable source report into navigable disclosure sections.
 * Section content is parsed separately into a safe, content-only Markdown tree.
 * @param {string} markdown
 */
export function parseAuditReport(markdown) {
  const normalized = String(markdown ?? '').replace(/\r\n?/g, '\n').trim();
  const firstLineEnd = normalized.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? normalized : normalized.slice(0, firstLineEnd);
  const title = firstLine.replace(/^#\s+/, '').trim();
  const remainder = firstLineEnd === -1 ? '' : normalized.slice(firstLineEnd + 1).trim();
  const matches = [...remainder.matchAll(/^##\s+(.+)$/gm)];
  const introduction = (matches.length ? remainder.slice(0, matches[0].index) : remainder).trim();
  const usedIds = new Set();
  const sections = matches.map((match, index) => {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? remainder.length;
    const sectionTitle = match[1].trim();

    return {
      id: reportId(sectionTitle, usedIds),
      title: sectionTitle,
      body: remainder.slice(bodyStart, bodyEnd).trim(),
    };
  });

  return { title, introduction, sections };
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableDelimiter(line) {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function safeLinkHref(value) {
  const href = value.trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null;
  if (/^(?:#|\/|\.\.\/|\.\/)/.test(href)) return href;
  try {
    const parsed = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? href : null;
  } catch {
    return null;
  }
}

export function parseMarkdownInlines(value) {
  const text = String(value ?? '');
  const tokens = [];
  const pattern = /(`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\))/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) tokens.push({ type: 'text', value: text.slice(cursor, match.index) });
    if (match[2] !== undefined) {
      tokens.push({ type: 'code', value: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: 'strong', value: match[3] });
    } else {
      const href = safeLinkHref(match[5]);
      tokens.push(href
        ? { type: 'link', value: match[4], href }
        : { type: 'text', value: match[0] });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) tokens.push({ type: 'text', value: text.slice(cursor) });
  return tokens;
}

function startsBlock(lines, index) {
  const line = lines[index] ?? '';
  return /^#{1,6}\s+/.test(line)
    || /^\s*(?:[-+*]|\d+\.)\s+/.test(line)
    || /^\s*>/.test(line)
    || /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || (line.includes('|') && isTableDelimiter(lines[index + 1] ?? ''));
}

/** Parses the report's supported Markdown into a content-only intermediate tree. */
export function parseMarkdownBlocks(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: parseMarkdownInlines(heading[2].trim()) });
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'thematic-break' });
      index += 1;
      continue;
    }

    if (line.includes('|') && isTableDelimiter(lines[index + 1] ?? '')) {
      const header = tableCells(line).map(parseMarkdownInlines);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(tableCells(lines[index]).map(parseMarkdownInlines));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    const ordered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (unordered || ordered) {
      const type = ordered ? 'ordered-list' : 'unordered-list';
      const items = [];
      const start = ordered ? Number(ordered[1]) : undefined;
      while (index < lines.length) {
        const item = type === 'ordered-list'
          ? lines[index].match(/^\s*\d+\.\s+(.+)$/)
          : lines[index].match(/^\s*[-+*]\s+(.+)$/);
        if (!item) break;
        items.push(parseMarkdownInlines(item[1]));
        index += 1;
      }
      blocks.push({ type, items, start });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', children: parseMarkdownBlocks(quoted.join('\n')) });
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', content: parseMarkdownInlines(paragraph.join(' ')) });
      continue;
    }
    index += 1;
  }

  return blocks;
}

/**
 * Wraps the board's deliberately small public Supabase RPC contract.
 * @param {{rpc: Function}} supabase
 * @param {string} token
 */
export function createBoardApi(supabase, token) {
  async function call(name, args) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw error;
    return data;
  }

  return {
    snapshot: () => call('board_snapshot', { token }),
    createTask: ({ author, title, description, priority, track, roadmapStage, roadmapIteration }) =>
      call('create_task', {
        token,
        author,
        title,
        description,
        priority,
        track,
        roadmap_stage: roadmapStage,
        roadmap_iteration: roadmapIteration,
      }),
    setCompleted: ({ author, taskId, completed }) =>
      call('set_task_completed', { token, author, task_id: taskId, completed }),
    addTaskComment: ({ author, taskId, body }) =>
      call('add_task_comment', { token, author, task_id: taskId, body }),
    addBoardComment: ({ author, body }) =>
      call('add_board_comment', { token, author, body }),
    addBoardMessage: ({ author, body, parentCommentId = null, attachments = [] }) =>
      call('add_board_message', {
        token,
        author,
        body,
        parent_comment_id: parentCommentId,
        attachments,
      }),
    addTaskMessage: ({ author, taskId, body, parentCommentId = null, attachments = [] }) =>
      call('add_task_message', {
        token,
        author,
        task_id: taskId,
        body,
        parent_comment_id: parentCommentId,
        attachments,
      }),
    toggleReaction: ({ author, commentId, emoji }) =>
      call('toggle_comment_reaction', { token, author, comment_id: commentId, emoji }),
    uploadMedia: ({ file }) => {
      if (typeof supabase.upload !== 'function') {
        throw new Error('Supabase Storage is not configured.');
      }
      return supabase.upload({ token, file });
    },
  };
}
