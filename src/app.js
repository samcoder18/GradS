import {
  auditProgress,
  filterTasks,
  normalizeAttachments,
  normalizeDisplayName,
  normalizeReplyId,
  normalizeTaskInput,
  parseBoardToken,
  priorityProgress,
  REACTION_OPTIONS,
} from './domain.js';
import {
  createBoardApi,
  createSupabaseRpcClient,
  parseAuditReport,
  parseMarkdownBlocks,
} from './client.js';

const DISPLAY_NAME_KEY = 'audit-tracker-display-name';
const MUTATION_CONTROL_SELECTOR = [
  '#open-new-task',
  '#new-task-form input',
  '#new-task-form textarea',
  '#new-task-form select',
  '#new-task-form button[type="submit"]',
  '#board-comment-form textarea',
  '#board-comment-form input[type="file"]',
  '#board-record-toggle',
  '#board-comment-form button[type="submit"]',
  '#task-comment-form textarea',
  '#task-comment-form input[type="file"]',
  '#task-record-toggle',
  '#task-comment-form button[type="submit"]',
  '#drawer-completed',
  '[data-complete-task]',
  '[data-reaction-comment]',
].join(', ');

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatRecordingTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function appendEmpty(document, container, text) {
  container.replaceChildren(element(document, 'p', 'empty-state', text));
}

function appendInlineContent(document, container, tokens) {
  for (const token of tokens) {
    if (token.type === 'text') {
      container.append(document.createTextNode(token.value));
    } else if (token.type === 'code') {
      container.append(element(document, 'code', null, token.value));
    } else if (token.type === 'strong') {
      container.append(element(document, 'strong', null, token.value));
    } else if (token.type === 'link') {
      const link = element(document, 'a', null, token.value);
      link.href = token.href;
      if (/^https?:/i.test(token.href)) link.rel = 'noreferrer';
      container.append(link);
    }
  }
}

function appendMarkdownBlocks(document, container, blocks) {
  for (const block of blocks) {
    if (block.type === 'thematic-break') {
      container.append(document.createElement('hr'));
    } else if (block.type === 'heading') {
      const heading = document.createElement(`h${block.level}`);
      appendInlineContent(document, heading, block.content);
      container.append(heading);
    } else if (block.type === 'paragraph') {
      const paragraph = document.createElement('p');
      appendInlineContent(document, paragraph, block.content);
      container.append(paragraph);
    } else if (block.type === 'ordered-list' || block.type === 'unordered-list') {
      const list = document.createElement(block.type === 'ordered-list' ? 'ol' : 'ul');
      if (block.start && block.start !== 1) list.start = block.start;
      for (const content of block.items) {
        const item = document.createElement('li');
        appendInlineContent(document, item, content);
        list.append(item);
      }
      container.append(list);
    } else if (block.type === 'blockquote') {
      const quote = document.createElement('blockquote');
      appendMarkdownBlocks(document, quote, block.children);
      container.append(quote);
    } else if (block.type === 'table') {
      const scroll = element(document, 'div', 'report-table-scroll');
      const table = document.createElement('table');
      const head = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const content of block.header) {
        const cell = document.createElement('th');
        cell.scope = 'col';
        appendInlineContent(document, cell, content);
        headRow.append(cell);
      }
      head.append(headRow);
      const body = document.createElement('tbody');
      for (const row of block.rows) {
        const tableRow = document.createElement('tr');
        for (const content of row) {
          const cell = document.createElement('td');
          appendInlineContent(document, cell, content);
          tableRow.append(cell);
        }
        body.append(tableRow);
      }
      table.append(head, body);
      scroll.append(table);
      container.append(scroll);
    }
  }
}

function renderMarkdown(document, container, markdown) {
  container.replaceChildren();
  appendMarkdownBlocks(document, container, parseMarkdownBlocks(markdown));
}

/**
 * Builds the browser client around an injected RPC adapter.
 * The injection keeps DOM behavior testable without making network requests.
 */
export function createAuditApp({
  document,
  window,
  api,
  initializationError = null,
  reportMarkdown = '',
  setIntervalFn = window.setInterval.bind(window),
  clearIntervalFn = window.clearInterval.bind(window),
}) {
  const nodes = {
    status: document.querySelector('#app-status'),
    initializationError: document.querySelector('#initialization-error'),
    initializationErrorTitle: document.querySelector('#initialization-error-title'),
    initializationErrorMessage: document.querySelector('#initialization-error-message'),
    taskList: document.querySelector('#task-list'),
    search: document.querySelector('#task-search'),
    priorityFilter: document.querySelector('#priority-filter'),
    statusFilter: document.querySelector('#status-filter'),
    completedCount: document.querySelector('#completed-count'),
    totalCount: document.querySelector('#total-count'),
    progressPercent: document.querySelector('#progress-percent'),
    progressTrack: document.querySelector('.progress-track'),
    progressFill: document.querySelector('#progress-fill'),
    priorityProgress: document.querySelector('#priority-progress'),
    chatPanel: document.querySelector('.chat-panel'),
    fullscreenChat: document.querySelector('#toggle-chat-fullscreen'),
    boardComments: document.querySelector('#board-comments'),
    boardCommentCount: document.querySelector('#board-comment-count'),
    boardCommentForm: document.querySelector('#board-comment-form'),
    boardComment: document.querySelector('#board-comment'),
    boardReply: document.querySelector('#board-reply'),
    boardReplyLabel: document.querySelector('#board-reply-label'),
    boardAttachmentDrafts: document.querySelector('#board-attachment-drafts'),
    boardFileInput: document.querySelector('#board-file-input'),
    boardRecordToggle: document.querySelector('#board-record-toggle'),
    boardCommentError: document.querySelector('#board-comment-error'),
    newTaskDialog: document.querySelector('#new-task-dialog'),
    newTaskForm: document.querySelector('#new-task-form'),
    newTaskName: document.querySelector('#new-task-name'),
    newTaskDescription: document.querySelector('#new-task-description'),
    newTaskPriority: document.querySelector('#new-task-priority'),
    newTaskNameError: document.querySelector('#new-task-name-error'),
    nameDialog: document.querySelector('#display-name-dialog'),
    nameForm: document.querySelector('#display-name-form'),
    nameInput: document.querySelector('#display-name'),
    nameError: document.querySelector('#display-name-error'),
    drawer: document.querySelector('#task-drawer'),
    drawerPriority: document.querySelector('#drawer-priority'),
    drawerTitle: document.querySelector('#drawer-title'),
    drawerDescription: document.querySelector('#drawer-description'),
    drawerCompleted: document.querySelector('#drawer-completed'),
    taskEvents: document.querySelector('#task-events'),
    taskComments: document.querySelector('#task-comments'),
    taskCommentCount: document.querySelector('#task-comment-count'),
    taskCommentForm: document.querySelector('#task-comment-form'),
    taskComment: document.querySelector('#task-comment'),
    taskReply: document.querySelector('#task-reply'),
    taskReplyLabel: document.querySelector('#task-reply-label'),
    taskAttachmentDrafts: document.querySelector('#task-attachment-drafts'),
    taskFileInput: document.querySelector('#task-file-input'),
    taskRecordToggle: document.querySelector('#task-record-toggle'),
    taskCommentError: document.querySelector('#task-comment-error'),
  };
  let board = { board: null, tasks: [], comments: [] };
  let selectedTaskId = null;
  let nameRequest = null;
  let intervalId = null;
  let started = false;
  let eventsBound = false;
  let refreshPromise = null;
  let mutationPending = false;
  let chatFullscreen = false;
  const composers = {
    board: { drafts: [], replyTo: null, recorder: null, recordingStartedAt: 0, recordingTimer: null, recordingStream: null },
    task: { drafts: [], replyTo: null, recorder: null, recordingStartedAt: 0, recordingTimer: null, recordingStream: null },
  };
  const mutationsAvailable = Boolean(api) && !initializationError;
  const dialogStack = [];

  function openManagedDialog(dialog, initialFocus) {
    if (dialog.hasAttribute('open')) return;
    dialogStack.push({ dialog, returnFocus: document.activeElement });
    openDialog(dialog);
    if (initialFocus) {
      window.setTimeout(() => {
        if (dialog.hasAttribute('open')) initialFocus.focus();
      }, 0);
    }
  }

  function closeManagedDialog(dialog) {
    const index = dialogStack.findLastIndex((entry) => entry.dialog === dialog);
    const [entry] = index === -1 ? [] : dialogStack.splice(index, 1);
    closeDialog(dialog);
    if (entry?.returnFocus?.isConnected) entry.returnFocus.focus();
  }

  function setStatus(message, kind = 'ready') {
    nodes.status.textContent = message;
    nodes.status.dataset.state = kind;
  }

  function setMutationPending(pending) {
    mutationPending = pending;
    for (const control of document.querySelectorAll(MUTATION_CONTROL_SELECTOR)) {
      control.disabled = pending || !mutationsAvailable;
    }
    for (const form of [nodes.newTaskForm, nodes.boardCommentForm, nodes.taskCommentForm]) {
      form.setAttribute('aria-busy', String(pending));
    }
  }

  function completionActionLabel(task) {
    return task.completed
      ? `Вернуть задачу «${task.title}» в работу`
      : `Отметить задачу «${task.title}» выполненной`;
  }

  function renderProgress() {
    const progress = auditProgress(board.tasks);
    nodes.completedCount.textContent = String(progress.completed);
    nodes.totalCount.textContent = String(progress.total);
    nodes.progressPercent.textContent = `${progress.percent}%`;
    nodes.progressTrack.setAttribute('aria-valuenow', String(progress.percent));
    nodes.progressFill.style.width = `${progress.percent}%`;
    nodes.priorityProgress.replaceChildren();

    for (const item of priorityProgress(board.tasks)) {
      const card = element(document, 'div', `priority-stat priority-${item.priority.toLowerCase()}`);
      const label = element(document, 'strong', null, item.priority);
      const value = element(document, 'span', null, `${item.completed}/${item.total}`);
      const bar = element(document, 'span', 'mini-progress');
      const fill = element(document, 'span');
      fill.style.width = `${item.percent}%`;
      bar.append(fill);
      card.append(label, value, bar);
      nodes.priorityProgress.append(card);
    }
  }

  function storedAuthor() {
    const result = normalizeDisplayName(window.localStorage.getItem(DISPLAY_NAME_KEY));
    return result.valid ? result.value : null;
  }

  function commentById(chatKey, id) {
    const comments = chatKey === 'board' ? board.comments : taskById(selectedTaskId)?.comments ?? [];
    return comments.find((comment) => comment.id === id) ?? null;
  }

  function safeMediaUrl(value) {
    const url = String(value ?? '').trim();
    if (!url) return null;
    try {
      const parsed = new URL(url, window.location.href);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
    } catch {
      return null;
    }
  }

  function renderAttachmentList(container, attachments, className = 'comment-attachments') {
    if (!Array.isArray(attachments) || !attachments.length) return;
    const list = element(document, 'div', className);
    for (const attachment of attachments) {
      const url = safeMediaUrl(attachment?.url);
      if (!url) continue;
      const card = element(document, 'div', 'comment-attachment');
      const name = String(attachment?.name || 'Вложение');
      if (attachment?.type === 'image') {
        const link = element(document, 'a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        const image = element(document, 'img');
        image.src = url;
        image.alt = name;
        link.append(image);
        card.append(link);
      } else {
        const audio = element(document, 'audio');
        audio.controls = true;
        audio.preload = 'metadata';
        audio.src = url;
        card.append(audio);
      }
      card.append(element(document, 'span', 'attachment-name', `${name} · ${formatBytes(attachment?.size)}`));
      list.append(card);
    }
    if (list.childElementCount) container.append(list);
  }

  function renderReactionButtons(item, comment, chatKey) {
    const actions = element(document, 'div', 'comment-actions');
    const reply = element(document, 'button', 'comment-action', 'Ответить');
    reply.type = 'button';
    reply.dataset.replyComment = comment.id;
    reply.dataset.chatScope = chatKey;
    actions.append(reply);
    const reactions = Array.isArray(comment.reactions) ? comment.reactions : [];
    const author = storedAuthor();
    for (const emoji of REACTION_OPTIONS) {
      const reaction = reactions.find((candidate) => candidate?.emoji === emoji);
      const count = Number(reaction?.count || 0);
      const authors = Array.isArray(reaction?.authors) ? reaction.authors : [];
      const button = element(document, 'button', `reaction-chip${author && authors.includes(author) ? ' is-active' : ''}`, `${emoji}${count ? ` ${count}` : ''}`);
      button.type = 'button';
      button.dataset.reactionComment = comment.id;
      button.dataset.reactionEmoji = emoji;
      button.dataset.chatScope = chatKey;
      button.setAttribute('aria-label', `${author && authors.includes(author) ? 'Убрать' : 'Поставить'} реакцию ${emoji}`);
      button.setAttribute('aria-pressed', String(Boolean(author && authors.includes(author))));
      actions.append(button);
    }
    item.append(actions);
  }

  function renderComments(container, comments, emptyText, chatKey) {
    container.replaceChildren();
    if (!comments.length) {
      container.append(element(document, 'li', 'empty-state', emptyText));
      return;
    }

    for (const comment of comments) {
      const item = element(document, 'li', 'comment');
      item.tabIndex = -1;
      item.dataset.commentId = comment.id;
      const parentId = normalizeReplyId(comment.parent_comment_id);
      if (parentId) item.dataset.parentCommentId = parentId;
      const header = element(document, 'div', 'comment-meta');
      const author = element(document, 'strong', null, comment.author);
      const time = element(document, 'time', null, formatDate(comment.created_at));
      time.dateTime = comment.created_at;
      header.append(author, time);
      item.append(header);
      if (parentId) {
        const parent = comments.find((candidate) => candidate.id === parentId);
        if (parent) {
          const quote = element(document, 'button', 'comment-reply-quote', `↩ ${parent.author}: ${String(parent.body || 'Вложение').slice(0, 90)}`);
          quote.type = 'button';
          quote.dataset.jumpComment = parentId;
          quote.dataset.chatScope = chatKey;
          item.append(quote);
        }
      }
      if (comment.body) item.append(element(document, 'p', null, comment.body));
      renderAttachmentList(item, comment.attachments);
      renderReactionButtons(item, comment, chatKey);
      container.append(item);
    }
  }

  function composerNodes(chatKey) {
    return chatKey === 'board'
      ? {
          form: nodes.boardCommentForm,
          body: nodes.boardComment,
          reply: nodes.boardReply,
          replyLabel: nodes.boardReplyLabel,
          drafts: nodes.boardAttachmentDrafts,
          fileInput: nodes.boardFileInput,
          record: nodes.boardRecordToggle,
          error: nodes.boardCommentError,
        }
      : {
          form: nodes.taskCommentForm,
          body: nodes.taskComment,
          reply: nodes.taskReply,
          replyLabel: nodes.taskReplyLabel,
          drafts: nodes.taskAttachmentDrafts,
          fileInput: nodes.taskFileInput,
          record: nodes.taskRecordToggle,
          error: nodes.taskCommentError,
        };
  }

  function releaseDraftUrl(draft) {
    if (draft?.previewUrl && typeof window.URL?.revokeObjectURL === 'function') {
      window.URL.revokeObjectURL(draft.previewUrl);
    }
  }

  function renderComposer(chatKey) {
    const state = composers[chatKey];
    const current = composerNodes(chatKey);
    current.reply.hidden = !state.replyTo;
    current.replyLabel.textContent = state.replyTo
      ? `Ответ для ${state.replyTo.author}: ${state.replyTo.preview}`
      : '';
    current.drafts.replaceChildren();
    for (const [index, draft] of state.drafts.entries()) {
      const card = element(document, 'div', 'attachment-draft');
      const file = draft.file;
      const previewUrl = draft.previewUrl || (typeof window.URL?.createObjectURL === 'function' ? window.URL.createObjectURL(file) : null);
      draft.previewUrl = previewUrl;
      if (draft.meta.type === 'image' && previewUrl) {
        const image = element(document, 'img');
        image.src = previewUrl;
        image.alt = draft.meta.name;
        card.append(image);
      } else if (draft.meta.type === 'audio' && previewUrl) {
        const audio = element(document, 'audio');
        audio.controls = true;
        audio.preload = 'metadata';
        audio.src = previewUrl;
        card.append(audio);
      }
      card.append(element(document, 'span', 'attachment-name', `${draft.meta.name} · ${formatBytes(draft.meta.size)}`));
      const remove = element(document, 'button', 'remove-attachment', 'Удалить');
      remove.type = 'button';
      remove.dataset.removeAttachment = String(index);
      remove.dataset.chatScope = chatKey;
      card.append(remove);
      current.drafts.append(card);
    }
    current.record.setAttribute('aria-pressed', String(Boolean(state.recorder)));
    current.record.textContent = state.recorder ? '■ Стоп' : '◉ Голос';
    if (state.recorder) current.record.dataset.recordingTime = formatRecordingTime(Math.floor((Date.now() - state.recordingStartedAt) / 1000));
    else delete current.record.dataset.recordingTime;
  }

  function taskById(id) {
    return board.tasks.find((task) => task.id === id) ?? null;
  }

  function renderDrawer() {
    const task = taskById(selectedTaskId);
    if (!task) {
      if (nodes.drawer.hasAttribute('open')) closeManagedDialog(nodes.drawer);
      selectedTaskId = null;
      return;
    }

    nodes.drawerPriority.textContent = `${task.priority} · задача ${task.position}`;
    nodes.drawerTitle.textContent = task.title;
    nodes.drawerDescription.textContent = task.description || 'Описание не добавлено.';
    nodes.drawerCompleted.checked = task.completed;
    nodes.drawerCompleted.disabled = mutationPending || !mutationsAvailable;
    nodes.drawerCompleted.setAttribute('aria-label', completionActionLabel(task));
    nodes.drawerCompleted.dataset.completeTask = task.id;
    nodes.taskEvents.replaceChildren();
    if (!task.events.length) {
      nodes.taskEvents.append(element(document, 'li', 'empty-state', 'История пока пуста.'));
    } else {
      for (const event of task.events) {
        const action = event.event_type === 'created'
          ? 'создал(а) задачу'
          : event.to_completed
            ? 'отметил(а) задачу выполненной'
            : 'вернул(а) задачу в работу';
        const item = element(document, 'li', 'event-item');
        const text = element(document, 'span', null, `${event.actor} ${action}`);
        const time = element(document, 'time', null, formatDate(event.created_at));
        time.dateTime = event.created_at;
        item.append(text, time);
        nodes.taskEvents.append(item);
      }
    }
    nodes.taskCommentCount.textContent = String(task.comments.length);
    renderComments(nodes.taskComments, task.comments, 'Комментариев пока нет.', 'task');
    renderComposer('task');
  }

  function renderTasks() {
    const tasks = filterTasks(board.tasks, {
      priority: nodes.priorityFilter.value,
      status: nodes.statusFilter.value,
      search: nodes.search.value,
    });
    nodes.taskList.replaceChildren();

    if (!tasks.length) {
      appendEmpty(document, nodes.taskList, board.tasks.length ? 'По этим фильтрам задач нет.' : 'Нет задач. Добавьте первую.');
      return;
    }

    for (const task of tasks) {
      const card = element(document, 'article', `task-card priority-${task.priority.toLowerCase()}${task.completed ? ' is-complete' : ''}`);
      const top = element(document, 'div', 'task-card-top');
      const priority = element(document, 'span', 'priority-badge', task.priority);
      const state = element(document, 'span', 'task-state', task.completed ? 'Выполнена' : 'Открыта');
      top.append(priority, state);
      const title = element(document, 'h3');
      const open = element(document, 'button', 'task-title-button', task.title);
      open.type = 'button';
      open.dataset.openTask = task.id;
      title.append(open);
      const description = element(document, 'p', 'task-description', task.description || 'Описание не добавлено.');
      const footer = element(document, 'div', 'task-card-footer');
      const meta = element(document, 'span', null, `${task.comments.length} комм. · ${task.events.length} событий`);
      const completion = element(document, 'label', 'compact-completion');
      const checkbox = element(document, 'input');
      checkbox.type = 'checkbox';
      checkbox.checked = task.completed;
      checkbox.disabled = mutationPending || !mutationsAvailable;
      checkbox.setAttribute('aria-label', completionActionLabel(task));
      checkbox.dataset.completeTask = task.id;
      const completionText = element(document, 'span', null, 'Готово');
      completion.append(checkbox, completionText);
      footer.append(meta, completion);
      card.append(top, title, description, footer);
      nodes.taskList.append(card);
    }
  }

  function renderBoard() {
    renderProgress();
    renderTasks();
    nodes.boardCommentCount.textContent = String(board.comments.length);
    renderComments(nodes.boardComments, board.comments, 'В общем чате пока тихо.', 'board');
    renderComposer('board');
    renderDrawer();
  }

  function renderReport() {
    const report = parseAuditReport(reportMarkdown);
    const title = document.querySelector('#report-title');
    const introduction = document.querySelector('#report-introduction');
    const navigation = document.querySelector('#report-navigation');
    const disclosures = document.querySelector('#report-disclosures');
    title.textContent = report.title || 'Технический аудит';
    renderMarkdown(document, introduction, report.introduction);
    navigation.replaceChildren();
    disclosures.replaceChildren();
    const navList = element(document, 'ol');

    for (const section of report.sections) {
      const navItem = element(document, 'li');
      const link = element(document, 'a', null, section.title);
      link.href = `#${section.id}`;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const target = document.querySelector(`#${section.id}`);
        target?.setAttribute('open', '');
        target?.querySelector('summary')?.focus({ preventScroll: true });
        target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      });
      navItem.append(link);
      navList.append(navItem);

      const details = element(document, 'details', 'report-section');
      details.id = section.id;
      const summary = document.createElement('summary');
      summary.append(element(document, 'h2', null, section.title));
      const body = element(document, 'div', 'report-body');
      renderMarkdown(document, body, section.body);
      details.append(summary, body);
      disclosures.append(details);
    }
    navigation.append(navList);
  }

  async function refresh({ silent = false } = {}) {
    if (!api || typeof api.snapshot !== 'function') return false;
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (!silent) setStatus('Загрузка общей доски…', 'loading');
      nodes.taskList.setAttribute('aria-busy', 'true');
      try {
        const snapshot = await api.snapshot();
        board = {
          board: snapshot?.board ?? null,
          tasks: Array.isArray(snapshot?.tasks) ? snapshot.tasks : [],
          comments: Array.isArray(snapshot?.comments) ? snapshot.comments : [],
        };
        renderBoard();
        if (!silent) {
          setStatus(`Доска обновлена · ${new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' }).format(new Date())}`);
        }
      } catch (error) {
        if (!silent) setStatus(`Не удалось обновить доску: ${error?.message || 'неизвестная ошибка'}`, 'error');
        if (!board.tasks.length) appendEmpty(document, nodes.taskList, 'Доска сейчас недоступна. Попробуйте обновить страницу.');
      } finally {
        nodes.taskList.setAttribute('aria-busy', 'false');
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  function requireDisplayName() {
    const saved = normalizeDisplayName(window.localStorage.getItem(DISPLAY_NAME_KEY));
    if (saved.valid) return Promise.resolve(saved.value);
    if (nameRequest) return nameRequest.promise;

    let resolveRequest;
    const promise = new Promise((resolve) => { resolveRequest = resolve; });
    nameRequest = { promise, resolve: resolveRequest };
    nodes.nameError.textContent = '';
    nodes.nameInput.value = '';
    openManagedDialog(nodes.nameDialog, nodes.nameInput);
    return promise;
  }

  async function performMutation(action) {
    if (!mutationsAvailable || mutationPending || typeof action !== 'function') return false;
    const author = await requireDisplayName();
    if (!author) {
      renderBoard();
      return false;
    }
    if (mutationPending) return false;
    setMutationPending(true);
    setStatus('Сохраняем изменение…', 'loading');
    try {
      await action(author);
      const staleRefresh = refreshPromise;
      if (staleRefresh) {
        try {
          await staleRefresh;
        } catch {
          // A background refresh failure cannot change the result of a successful write.
        }
        if (refreshPromise === staleRefresh) refreshPromise = null;
      }
      await refresh({ silent: true });
      setStatus('Изменение сохранено.');
      return true;
    } catch (error) {
      setStatus(`Не удалось сохранить: ${error?.message || 'неизвестная ошибка'}`, 'error');
      renderBoard();
      return false;
    } finally {
      setMutationPending(false);
    }
  }

  function clearComposer(chatKey) {
    const state = composers[chatKey];
    for (const draft of state.drafts) releaseDraftUrl(draft);
    state.drafts = [];
    state.replyTo = null;
    const current = composerNodes(chatKey);
    current.form.reset();
    current.fileInput.value = '';
    current.error.textContent = '';
    renderComposer(chatKey);
  }

  function setComposerError(chatKey, message) {
    composerNodes(chatKey).error.textContent = message || '';
  }

  function handleFileSelection(chatKey, files) {
    const state = composers[chatKey];
    const selected = [...(files ?? [])];
    const result = normalizeAttachments([...state.drafts.map((draft) => draft.file), ...selected]);
    if (!result.valid) {
      setComposerError(chatKey, result.error);
      composerNodes(chatKey).fileInput.value = '';
      return;
    }
    const start = state.drafts.length;
    state.drafts.push(...selected.map((file, index) => ({ file, meta: result.value[start + index] })));
    setComposerError(chatKey, '');
    composerNodes(chatKey).fileInput.value = '';
    renderComposer(chatKey);
  }

  function removeDraft(chatKey, index) {
    const state = composers[chatKey];
    const [draft] = state.drafts.splice(index, 1);
    releaseDraftUrl(draft);
    renderComposer(chatKey);
  }

  function setReply(chatKey, commentId) {
    const comment = commentById(chatKey, commentId);
    if (!comment) return;
    composers[chatKey].replyTo = {
      id: comment.id,
      author: comment.author,
      preview: String(comment.body || 'Вложение').slice(0, 90),
    };
    renderComposer(chatKey);
    composerNodes(chatKey).body.focus();
  }

  function cancelReply(chatKey) {
    composers[chatKey].replyTo = null;
    renderComposer(chatKey);
    composerNodes(chatKey).body.focus();
  }

  async function submitChatMessage(chatKey) {
    const current = composerNodes(chatKey);
    const state = composers[chatKey];
    const body = current.body.value.trim();
    if (!body && !state.drafts.length) {
      setComposerError(chatKey, 'Напишите сообщение или добавьте вложение.');
      current.body.focus();
      return;
    }
    setComposerError(chatKey, '');
    const replyId = state.replyTo?.id ?? null;
    const saved = await performMutation(async (author) => {
      if (!state.drafts.length && !replyId && chatKey === 'board' && typeof api.addBoardMessage !== 'function') {
        return api.addBoardComment({ author, body });
      }
      if (!state.drafts.length && !replyId && chatKey === 'task' && typeof api.addTaskMessage !== 'function') {
        return api.addTaskComment({ author, taskId: selectedTaskId, body });
      }
      if (typeof api.uploadMedia !== 'function' && state.drafts.length) {
        throw new Error('Загрузка вложений сейчас недоступна.');
      }
      const attachments = [];
      for (const draft of state.drafts) {
        attachments.push(await api.uploadMedia({ file: draft.file }));
      }
      if (chatKey === 'board') {
        return api.addBoardMessage({ author, body, parentCommentId: replyId, attachments });
      }
      return api.addTaskMessage({ author, taskId: selectedTaskId, body, parentCommentId: replyId, attachments });
    });
    if (saved) clearComposer(chatKey);
  }

  async function toggleReaction(chatKey, commentId, emoji) {
    if (typeof api.toggleReaction !== 'function') {
      setComposerError(chatKey, 'Реакции сейчас недоступны.');
      return;
    }
    await performMutation((author) => api.toggleReaction({ author, commentId, emoji }));
  }

  function handleCommentAction(chatKey, event) {
    const reply = event.target.closest('[data-reply-comment]');
    if (reply) {
      setReply(chatKey, reply.dataset.replyComment);
      return;
    }
    const cancel = event.target.closest('[data-cancel-reply]');
    if (cancel) {
      cancelReply(chatKey);
      return;
    }
    const reaction = event.target.closest('[data-reaction-comment]');
    if (reaction) {
      void toggleReaction(chatKey, reaction.dataset.reactionComment, reaction.dataset.reactionEmoji);
      return;
    }
    const jump = event.target.closest('[data-jump-comment]');
    if (jump) {
      const container = chatKey === 'board' ? nodes.boardComments : nodes.taskComments;
      const target = [...container.querySelectorAll('[data-comment-id]')].find((item) => item.dataset.commentId === jump.dataset.jumpComment);
      target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      target?.focus?.({ preventScroll: true });
    }
  }

  function setChatFullscreen(enabled) {
    chatFullscreen = enabled;
    nodes.chatPanel.classList.toggle('is-fullscreen', enabled);
    document.body.classList.toggle('chat-is-fullscreen', enabled);
    nodes.fullscreenChat.setAttribute('aria-pressed', String(enabled));
    nodes.fullscreenChat.setAttribute('aria-label', enabled ? 'Свернуть чат' : 'Открыть чат на весь экран');
    nodes.fullscreenChat.title = enabled ? 'Свернуть чат' : 'Открыть чат на весь экран';
    nodes.fullscreenChat.textContent = enabled ? '×' : '⛶';
  }

  async function toggleRecording(chatKey) {
    const state = composers[chatKey];
    if (state.recorder) {
      state.recorder.stop();
      return;
    }
    const Recorder = window.MediaRecorder;
    const getUserMedia = window.navigator?.mediaDevices?.getUserMedia;
    if (typeof Recorder !== 'function' || typeof getUserMedia !== 'function') {
      setComposerError(chatKey, 'Запись голоса не поддерживается этим браузером. Можно прикрепить готовый аудиофайл.');
      return;
    }
    try {
      const stream = await getUserMedia.call(window.navigator.mediaDevices, { audio: true });
      const recorder = new Recorder(stream);
      const chunks = [];
      state.recorder = recorder;
      state.recordingStream = stream;
      state.recordingStartedAt = Date.now();
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new window.Blob(chunks, { type: mimeType });
        const fileName = `voice-${Date.now()}.webm`;
        let file = blob;
        if (typeof window.File === 'function') file = new window.File([blob], fileName, { type: mimeType });
        else Object.defineProperty(file, 'name', { value: fileName });
        const result = normalizeAttachments([file]);
        if (result.valid) {
          const current = composers[chatKey];
          const combined = normalizeAttachments([...current.drafts.map((draft) => draft.file), file]);
          if (combined.valid) current.drafts.push({ file, meta: result.value[0] });
          else setComposerError(chatKey, combined.error);
        } else setComposerError(chatKey, result.error);
        state.recorder = null;
        state.recordingStream = null;
        if (state.recordingTimer !== null) window.clearInterval(state.recordingTimer);
        state.recordingTimer = null;
        renderComposer(chatKey);
      });
      recorder.start();
      state.recordingTimer = window.setInterval(() => renderComposer(chatKey), 1000);
      setComposerError(chatKey, '');
      renderComposer(chatKey);
    } catch (error) {
      state.recorder = null;
      state.recordingStream = null;
      setComposerError(chatKey, error?.message || 'Не удалось получить доступ к микрофону.');
      renderComposer(chatKey);
    }
  }

  function stopRecording(chatKey) {
    const state = composers[chatKey];
    if (state.recordingTimer !== null) window.clearInterval(state.recordingTimer);
    state.recordingTimer = null;
    if (state.recorder) state.recorder.stop();
    for (const track of state.recordingStream?.getTracks?.() ?? []) track.stop();
    state.recordingStream = null;
  }

  async function handleCompletion(checkbox) {
    const taskId = checkbox.dataset.completeTask;
    if (!taskById(taskId)) return;
    await performMutation((author) => api.setCompleted({ author, taskId, completed: checkbox.checked }));
  }

  function showTask(id) {
    selectedTaskId = id;
    renderDrawer();
    openManagedDialog(nodes.drawer, document.querySelector('[data-close-drawer]'));
  }

  function switchTab(tab) {
    for (const candidate of document.querySelectorAll('[role="tab"]')) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      document.querySelector(`#${candidate.getAttribute('aria-controls')}`).hidden = !selected;
    }
  }

  function cancelNameRequest() {
    closeManagedDialog(nodes.nameDialog);
    const request = nameRequest;
    nameRequest = null;
    request?.resolve(null);
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    document.querySelector('.skip-link').addEventListener('click', (event) => {
      event.preventDefault();
      const main = document.querySelector('#main-content');
      main.focus({ preventScroll: true });
      main.scrollIntoView?.({ block: 'start' });
    });
    document.querySelector('.brand').addEventListener('click', (event) => {
      event.preventDefault();
      switchTab(document.querySelector('#tracker-tab'));
      document.querySelector('#main-content').scrollIntoView?.({ block: 'start' });
    });

    for (const tab of document.querySelectorAll('[role="tab"]')) {
      tab.addEventListener('click', () => switchTab(tab));
      tab.addEventListener('keydown', (event) => {
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        const index = tabs.indexOf(tab);
        let next = null;
        if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
        if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
        if (event.key === 'Home') next = tabs[0];
        if (event.key === 'End') next = tabs.at(-1);
        if (next) {
          event.preventDefault();
          switchTab(next);
          next.focus();
        }
      });
    }

    for (const input of [nodes.search, nodes.priorityFilter, nodes.statusFilter]) {
      input.addEventListener(input === nodes.search ? 'input' : 'change', renderTasks);
    }

    nodes.taskList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-open-task]');
      if (button) showTask(button.dataset.openTask);
    });
    nodes.taskList.addEventListener('change', (event) => {
      if (event.target.matches('[data-complete-task]')) void handleCompletion(event.target);
    });
    nodes.boardComments.addEventListener('click', (event) => handleCommentAction('board', event));
    nodes.taskComments.addEventListener('click', (event) => handleCommentAction('task', event));
    nodes.boardFileInput.addEventListener('change', () => handleFileSelection('board', nodes.boardFileInput.files));
    nodes.taskFileInput.addEventListener('change', () => handleFileSelection('task', nodes.taskFileInput.files));
    nodes.boardRecordToggle.addEventListener('click', () => void toggleRecording('board'));
    nodes.taskRecordToggle.addEventListener('click', () => void toggleRecording('task'));
    nodes.boardCommentForm.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove-attachment]');
      if (remove) removeDraft('board', Number(remove.dataset.removeAttachment));
      const cancel = event.target.closest('[data-cancel-reply]');
      if (cancel) cancelReply('board');
    });
    nodes.taskCommentForm.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove-attachment]');
      if (remove) removeDraft('task', Number(remove.dataset.removeAttachment));
      const cancel = event.target.closest('[data-cancel-reply]');
      if (cancel) cancelReply('task');
    });
    nodes.fullscreenChat.addEventListener('click', () => setChatFullscreen(!chatFullscreen));
    nodes.drawerCompleted.addEventListener('change', () => void handleCompletion(nodes.drawerCompleted));
    document.querySelector('[data-close-drawer]').addEventListener('click', () => closeManagedDialog(nodes.drawer));
    document.querySelector('#open-new-task').addEventListener('click', () => {
      nodes.newTaskNameError.textContent = '';
      openManagedDialog(nodes.newTaskDialog, nodes.newTaskName);
    });
    for (const close of document.querySelectorAll('[data-close-dialog]')) {
      close.addEventListener('click', () => closeManagedDialog(close.closest('dialog')));
    }

    nodes.nameForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = normalizeDisplayName(nodes.nameInput.value);
      if (!result.valid) {
        nodes.nameError.textContent = result.error;
        nodes.nameInput.focus();
        return;
      }
      window.localStorage.setItem(DISPLAY_NAME_KEY, result.value);
      closeManagedDialog(nodes.nameDialog);
      const request = nameRequest;
      nameRequest = null;
      request?.resolve(result.value);
    });
    document.querySelector('[data-cancel-name]').addEventListener('click', () => {
      cancelNameRequest();
    });
    nodes.nameDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      cancelNameRequest();
    });

    nodes.newTaskForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = normalizeTaskInput({ title: nodes.newTaskName.value, priority: nodes.newTaskPriority.value });
      if (!result.valid) {
        nodes.newTaskNameError.textContent = result.errors.title ?? result.errors.priority ?? '';
        return;
      }
      const saved = await performMutation((author) => api.createTask({
        author,
        title: result.value.title,
        description: nodes.newTaskDescription.value.trim(),
        priority: result.value.priority,
      }));
      if (saved) {
        nodes.newTaskForm.reset();
        nodes.newTaskPriority.value = 'P1';
        closeManagedDialog(nodes.newTaskDialog);
      }
    });

    nodes.boardCommentForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitChatMessage('board');
    });
    nodes.taskCommentForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!selectedTaskId) return;
      void submitChatMessage('task');
    });
    for (const [chatKey, current] of [['board', nodes.boardComment], ['task', nodes.taskComment]]) {
      current.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        current.form.requestSubmit?.();
      });
    }

    document.querySelector('#expand-report').addEventListener('click', () => {
      for (const details of document.querySelectorAll('#report-disclosures details')) details.open = true;
    });
    document.querySelector('#collapse-report').addEventListener('click', () => {
      for (const details of document.querySelectorAll('#report-disclosures details')) details.open = false;
    });
  }

  function handleFocus() {
    void refresh({ silent: true });
  }

  function handleDocumentKeydown(event) {
    if (event.key !== 'Escape') return;
    if (chatFullscreen) {
      event.preventDefault();
      setChatFullscreen(false);
      nodes.fullscreenChat.focus();
      return;
    }
    const entry = dialogStack.findLast(({ dialog }) => dialog.hasAttribute('open'));
    if (!entry) return;
    event.preventDefault();
    if (entry.dialog === nodes.nameDialog) cancelNameRequest();
    else closeManagedDialog(entry.dialog);
  }

  return {
    async start() {
      if (started) return;
      started = true;
      renderReport();
      renderBoard();
      bindEvents();
      document.addEventListener('keydown', handleDocumentKeydown);
      if (initializationError) {
        nodes.initializationError.hidden = false;
        nodes.initializationError.dataset.state = initializationError.kind;
        nodes.initializationErrorTitle.textContent = initializationError.kind === 'invalid-link'
          ? 'Ссылка на доску недействительна'
          : 'Доска не настроена';
        nodes.initializationErrorMessage.textContent = initializationError.message;
        setStatus(initializationError.message, initializationError.kind);
        setMutationPending(false);
        nodes.taskList.setAttribute('aria-busy', 'false');
        appendEmpty(document, nodes.taskList, 'Совместная доска недоступна. Полный отчёт можно читать во вкладке «Отчёт».');
        return;
      }
      nodes.initializationError.hidden = true;
      window.addEventListener('focus', handleFocus);
      await refresh();
      intervalId = setIntervalFn(() => refresh({ silent: true }), 20_000);
    },
    stop() {
      if (!started) return;
      started = false;
      stopRecording('board');
      stopRecording('task');
      if (chatFullscreen) setChatFullscreen(false);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('keydown', handleDocumentKeydown);
      if (intervalId !== null) clearIntervalFn(intervalId);
      intervalId = null;
    },
    refresh,
  };
}

export async function initializeBoardApi({
  hash,
  loadConfig = () => import('./config.js'),
  fetchFn = globalThis.fetch,
}) {
  const token = parseBoardToken(hash);
  if (!token) {
    return {
      api: null,
      error: { kind: 'invalid-link', message: 'В ссылке нет корректного токена доски.' },
    };
  }

  let config;
  try {
    config = await loadConfig();
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || config.SUPABASE_URL.includes('YOUR_PROJECT')) {
      throw new Error('invalid public configuration');
    }
    const rpcClient = createSupabaseRpcClient({
      url: config.SUPABASE_URL,
      anonKey: config.SUPABASE_ANON_KEY,
      fetchFn,
    });
    return { api: createBoardApi(rpcClient, token), error: null };
  } catch {
    return {
      api: null,
      error: { kind: 'configuration-error', message: 'Добавьте публичные настройки Supabase в src/config.js.' },
    };
  }
}

async function bootstrap() {
  const reportPromise = fetch(new URL('../audit-report.md', import.meta.url)).then((response) => {
    if (!response.ok) throw new Error('Не удалось загрузить файл отчёта.');
    return response.text();
  });
  const initialization = await initializeBoardApi({ hash: window.location.hash });

  let reportMarkdown = '';
  try {
    reportMarkdown = await reportPromise;
  } catch (error) {
    reportMarkdown = `# Технический аудит\n\n${error.message}`;
  }
  await createAuditApp({
    document,
    window,
    api: initialization.api,
    initializationError: initialization.error,
    reportMarkdown,
  }).start();
}

if (typeof document !== 'undefined' && document.querySelector('#task-list')) {
  void bootstrap();
}
