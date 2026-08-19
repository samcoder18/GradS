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

/**
 * Splits the immutable source report into navigable disclosure sections.
 * Markdown remains plain text inside each section so nothing is interpreted as HTML.
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
    createTask: ({ author, title, description, priority }) =>
      call('create_task', { token, author, title, description, priority }),
    setCompleted: ({ author, taskId, completed }) =>
      call('set_task_completed', { token, author, task_id: taskId, completed }),
    addTaskComment: ({ author, taskId, body }) =>
      call('add_task_comment', { token, author, task_id: taskId, body }),
    addBoardComment: ({ author, body }) =>
      call('add_board_comment', { token, author, body }),
  };
}
