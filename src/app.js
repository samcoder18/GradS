import {
  normalizeAttachments,
  normalizeComment,
  normalizeDisplayName,
  normalizeReplyId,
  normalizeTaskInput,
  parseBoardToken,
  REACTION_OPTIONS,
} from './domain.js';
import {
  createBoardApi,
  createSupabaseRpcClient,
  parseAuditReport,
  parseMarkdownBlocks,
} from './client.js';
import {
  ROADMAP_ITERATIONS,
  ROADMAP_STAGES,
  filterRoadmapTasks,
  roadmapIterationProgress,
  roadmapProgress,
  roadmapStageGroups,
} from './roadmap.js';

const DISPLAY_NAME_KEY = 'audit-tracker-display-name';
const MUTATION_CONTROL_SELECTOR = [
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
  '[data-create-roadmap-task]',
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
  roadmapMarkdown = '',
  setIntervalFn = window.setInterval.bind(window),
  clearIntervalFn = window.clearInterval.bind(window),
}) {
  const nodes = {
    roadmapTrackerTab: document.querySelector('#roadmap-tracker-tab'),
    roadmapStrategyTab: document.querySelector('#roadmap-strategy-tab'),
    status: document.querySelector('#app-status'),
    initializationError: document.querySelector('#initialization-error'),
    initializationErrorTitle: document.querySelector('#initialization-error-title'),
    initializationErrorMessage: document.querySelector('#initialization-error-message'),
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
    roadmapTaskList: document.querySelector('#roadmap-stage-list'),
    roadmapSearch: document.querySelector('#roadmap-search'),
    roadmapStageFilter: document.querySelector('#roadmap-stage-filter'),
    roadmapStatusFilter: document.querySelector('#roadmap-status-filter'),
    roadmapCompletedCount: document.querySelector('#roadmap-completed-count'),
    roadmapTotalCount: document.querySelector('#roadmap-total-count'),
    roadmapProgressPercent: document.querySelector('#roadmap-progress-percent'),
    roadmapProgressTrack: document.querySelector('#roadmap-tracker .progress-track'),
    roadmapProgressFill: document.querySelector('#roadmap-progress-fill'),
    roadmapIterationProgress: document.querySelector('#roadmap-iteration-progress'),
    newTaskDialog: document.querySelector('#new-task-dialog'),
    newTaskForm: document.querySelector('#new-task-form'),
    newTaskName: document.querySelector('#new-task-name'),
    newTaskDescription: document.querySelector('#new-task-description'),
    newTaskContext: document.querySelector('#new-task-context'),
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
  let newTaskContext = { track: 'roadmap', roadmapStage: 0, roadmapIteration: 2 };
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

    nodes.drawerPriority.textContent = `Этап ${task.roadmap_stage} · Итерация ${task.roadmap_iteration}`;
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

  function renderTaskCard(task) {
    const card = element(document, 'article', `task-card roadmap-task${task.completed ? ' is-complete' : ''}`);
    const top = element(document, 'div', 'task-card-top');
    const label = element(document, 'span', 'priority-badge', `Этап ${task.roadmap_stage}`);
    const state = element(document, 'span', 'task-state', task.completed ? 'Выполнена' : 'Открыта');
    top.append(label, state);
    const title = element(document, 'h3');
    const open = element(document, 'button', 'task-title-button', task.title);
    open.type = 'button';
    open.dataset.openTask = task.id;
    title.append(open);
    const description = element(document, 'p', 'task-description', task.description || `Итерация ${task.roadmap_iteration}`);
    const footer = element(document, 'div', 'task-card-footer');
    const meta = element(document, 'span', null, `${(task.comments ?? []).length} комм. · ${(task.events ?? []).length} событий`);
    footer.append(meta);
    const completion = element(document, 'label', 'compact-completion');
    const checkbox = element(document, 'input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.completed;
    checkbox.disabled = mutationPending || !mutationsAvailable;
    checkbox.setAttribute('aria-label', completionActionLabel(task));
    checkbox.dataset.completeTask = task.id;
    completion.append(checkbox, element(document, 'span', null, 'Готово'));
    footer.append(completion);
    card.append(top, title, description, footer);
    return card;
  }

  function stageIterationOptions(stage) {
    if (stage === 1) return [1];
    if (stage === 2) return [1, 2, 3];
    if (stage === 8) return [3];
    return [2];
  }

  function renderRoadmap() {
    const allRoadmapTasks = board.tasks.filter((task) => task.track === 'roadmap');
    const progress = roadmapProgress(allRoadmapTasks);
    nodes.roadmapCompletedCount.textContent = String(progress.completed);
    nodes.roadmapTotalCount.textContent = String(progress.total);
    nodes.roadmapProgressPercent.textContent = `${progress.percent}%`;
    nodes.roadmapProgressTrack.setAttribute('aria-valuenow', String(progress.percent));
    nodes.roadmapProgressFill.style.width = `${progress.percent}%`;
    nodes.roadmapIterationProgress.replaceChildren();
    for (const iteration of ROADMAP_ITERATIONS) {
      const value = roadmapIterationProgress(allRoadmapTasks, iteration.iteration);
      const card = element(document, 'div', 'roadmap-iteration-card');
      card.append(
        element(document, 'strong', null, `Итерация ${iteration.iteration}`),
        element(document, 'span', null, iteration.title),
        element(document, 'span', null, `${value.completed}/${value.total}`),
      );
      nodes.roadmapIterationProgress.append(card);
    }

    const visibleTasks = filterRoadmapTasks(allRoadmapTasks, {
      stage: nodes.roadmapStageFilter.value,
      status: nodes.roadmapStatusFilter.value,
      search: nodes.roadmapSearch.value,
    });
    nodes.roadmapTaskList.replaceChildren();
    for (const { stage, title } of ROADMAP_STAGES) {
      const stageTasks = allRoadmapTasks.filter((task) => task.roadmap_stage === stage);
      const stageProgress = roadmapProgress(stageTasks);
      const details = element(document, 'details', 'roadmap-stage');
      details.open = stage === 0;
      const summary = document.createElement('summary');
      summary.append(
        element(document, 'strong', null, `Этап ${stage}`),
        element(document, 'span', null, title),
        element(document, 'span', 'count-badge', `${stageProgress.completed}/${stageProgress.total}`),
      );
      details.append(summary);
      const body = element(document, 'div', 'roadmap-stage-body');
      const groups = roadmapStageGroups(allRoadmapTasks, stage);
      const groupsByIteration = new Map(groups.map((group) => [group.iteration, group]));
      for (const iteration of stageIterationOptions(stage)) {
        const group = groupsByIteration.get(iteration) ?? { iteration, tasks: [] };
        const groupTasks = visibleTasks
          .filter((task) => task.roadmap_stage === stage && task.roadmap_iteration === iteration)
          .sort((left, right) => left.position - right.position);
        const groupContainer = element(document, 'div', 'roadmap-stage-group');
        if (stage === 2) groupContainer.append(element(document, 'h3', null, `Итерация ${iteration}`));
        const list = element(document, 'div', 'task-list roadmap-task-list');
        if (!groupTasks.length) appendEmpty(document, list, 'По этим фильтрам задач нет.');
        else for (const task of groupTasks) list.append(renderTaskCard(task));
        const add = element(document, 'button', 'button button-quiet', 'Добавить задачу');
        add.type = 'button';
        add.dataset.createRoadmapTask = '';
        add.dataset.roadmapStage = String(stage);
        add.dataset.roadmapIteration = String(group.iteration);
        groupContainer.append(list, add);
        body.append(groupContainer);
      }
      details.append(body);
      nodes.roadmapTaskList.append(details);
    }
  }

  function renderBoard() {
    renderRoadmap();
    nodes.boardCommentCount.textContent = String(board.comments.length);
    renderComments(nodes.boardComments, board.comments, 'В общем чате пока тихо.', 'board');
    renderComposer('board');
    renderDrawer();
  }

  function renderReportDocument(markdown, {
    titleSelector,
    introductionSelector,
    navigationSelector,
    disclosuresSelector,
    fallbackTitle,
    idPrefix,
  }) {
    const report = parseAuditReport(markdown);
    const title = document.querySelector(titleSelector);
    const introduction = document.querySelector(introductionSelector);
    const navigation = document.querySelector(navigationSelector);
    const disclosures = document.querySelector(disclosuresSelector);
    title.textContent = report.title || fallbackTitle;
    renderMarkdown(document, introduction, report.introduction);
    navigation.replaceChildren();
    disclosures.replaceChildren();
    const navList = element(document, 'ol');

    for (const section of report.sections) {
      const sectionId = `${idPrefix}${section.id}`;
      const navItem = element(document, 'li');
      const link = element(document, 'a', null, section.title);
      link.href = `#${sectionId}`;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        for (const candidate of navigation.querySelectorAll('a')) candidate.removeAttribute('aria-current');
        link.setAttribute('aria-current', 'true');
        const target = document.querySelector(`#${sectionId}`);
        target?.setAttribute('open', '');
        target?.querySelector('summary')?.focus({ preventScroll: true });
        target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      });
      navItem.append(link);
      navList.append(navItem);

      const details = element(document, 'details', 'report-section');
      details.id = sectionId;
      const summary = document.createElement('summary');
      summary.append(element(document, 'h2', null, section.title));
      const body = element(document, 'div', 'report-body');
      renderMarkdown(document, body, section.body);
      details.append(summary, body);
      disclosures.append(details);
    }
    navigation.append(navList);
  }

  function renderRoadmapStrategy() {
    renderReportDocument(roadmapMarkdown, {
      titleSelector: '#roadmap-strategy-title',
      introductionSelector: '#roadmap-strategy-introduction',
      navigationSelector: '#roadmap-strategy-navigation',
      disclosuresSelector: '#roadmap-strategy-disclosures',
      fallbackTitle: 'Стратегия развития',
      idPrefix: 'roadmap-',
    });
  }

  async function refresh({ silent = false } = {}) {
    if (!api || typeof api.snapshot !== 'function') return false;
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (!silent) setStatus('Загрузка общей доски…', 'loading');
      nodes.roadmapTaskList.setAttribute('aria-busy', 'true');
      try {
        const snapshot = await api.snapshot();
        board = {
          board: snapshot?.board ?? null,
          tasks: Array.isArray(snapshot?.tasks)
            ? snapshot.tasks
              .filter((task) => task?.track === 'roadmap')
              .map((task) => ({
              ...task,
              track: 'roadmap',
              completion_mode: task.completion_mode ?? 'manual',
              events: Array.isArray(task.events) ? task.events : [],
              comments: Array.isArray(task.comments) ? task.comments : [],
              audit_links: Array.isArray(task.audit_links) ? task.audit_links : [],
              }))
            : [],
          comments: Array.isArray(snapshot?.comments) ? snapshot.comments : [],
        };
        renderBoard();
        if (!silent) {
          setStatus(`Доска обновлена · ${new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' }).format(new Date())}`);
        }
      } catch (error) {
        if (!silent) setStatus(`Не удалось обновить доску: ${error?.message || 'неизвестная ошибка'}`, 'error');
        if (!board.tasks.length) appendEmpty(document, nodes.roadmapTaskList, 'Доска сейчас недоступна. Попробуйте обновить страницу.');
      } finally {
        nodes.roadmapTaskList.setAttribute('aria-busy', 'false');
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
    const tablist = tab.closest('[role="tablist"]');
    for (const candidate of tablist.querySelectorAll('[role="tab"]')) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      document.querySelector(`#${candidate.getAttribute('aria-controls')}`).hidden = !selected;
    }
  }

  function openNewTask(context = { track: 'roadmap', roadmapStage: 0, roadmapIteration: 2 }) {
    newTaskContext = context;
    nodes.newTaskNameError.textContent = '';
    nodes.newTaskDialog.dataset.track = context.track;
    nodes.newTaskContext.textContent = `Roadmap · этап ${context.roadmapStage} · итерация ${context.roadmapIteration}`;
    openManagedDialog(nodes.newTaskDialog, nodes.newTaskName);
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
      switchTab(nodes.roadmapTrackerTab);
      document.querySelector('#main-content').scrollIntoView?.({ block: 'start' });
    });

    for (const tab of document.querySelectorAll('[role="tab"]')) {
      tab.addEventListener('click', () => switchTab(tab));
      tab.addEventListener('keydown', (event) => {
        const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
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

    for (const input of [nodes.roadmapSearch, nodes.roadmapStageFilter, nodes.roadmapStatusFilter]) {
      input.addEventListener(input === nodes.roadmapSearch ? 'input' : 'change', renderRoadmap);
    }
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
    nodes.roadmapTaskList.addEventListener('click', (event) => {
      const open = event.target.closest('[data-open-task]');
      if (open) {
        showTask(open.dataset.openTask);
        return;
      }
      const create = event.target.closest('[data-create-roadmap-task]');
      if (create) {
        openNewTask({
          track: 'roadmap',
          roadmapStage: Number(create.dataset.roadmapStage),
          roadmapIteration: Number(create.dataset.roadmapIteration),
        });
      }
    });
    nodes.roadmapTaskList.addEventListener('change', (event) => {
      if (event.target.matches('[data-complete-task]')) void handleCompletion(event.target);
    });
    nodes.drawerCompleted.addEventListener('change', () => void handleCompletion(nodes.drawerCompleted));
    document.querySelector('[data-close-drawer]').addEventListener('click', () => closeManagedDialog(nodes.drawer));
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
      const result = normalizeTaskInput({
        title: nodes.newTaskName.value,
        priority: null,
        ...newTaskContext,
      });
      if (!result.valid) {
        nodes.newTaskNameError.textContent = result.errors.title ?? result.errors.priority ?? result.errors.roadmap ?? result.errors.track ?? '';
        return;
      }
      const saved = await performMutation((author) => api.createTask({
        author,
        title: result.value.title,
        description: nodes.newTaskDescription.value.trim(),
        priority: result.value.priority,
        track: 'roadmap',
        roadmapStage: result.value.roadmapStage ?? null,
        roadmapIteration: result.value.roadmapIteration ?? null,
      }));
      if (saved) {
        nodes.newTaskForm.reset();
        newTaskContext = { track: 'roadmap', roadmapStage: 0, roadmapIteration: 2 };
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

    document.querySelector('#expand-roadmap-strategy').addEventListener('click', () => {
      for (const details of document.querySelectorAll('#roadmap-strategy-disclosures details')) details.open = true;
    });
    document.querySelector('#collapse-roadmap-strategy').addEventListener('click', () => {
      for (const details of document.querySelectorAll('#roadmap-strategy-disclosures details')) details.open = false;
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
      renderRoadmapStrategy();
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
        nodes.roadmapTaskList.setAttribute('aria-busy', 'false');
        appendEmpty(document, nodes.roadmapTaskList, 'Совместная roadmap-доска недоступна. Проверьте ссылку и обновите страницу.');
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
  const roadmapPromise = fetch(new URL('../roadmap-report.md', import.meta.url)).then((response) => {
    if (!response.ok) throw new Error('Не удалось загрузить файл стратегии.');
    return response.text();
  });
  const initialization = await initializeBoardApi({ hash: window.location.hash });

  let roadmapMarkdown = '';
  try {
    roadmapMarkdown = await roadmapPromise;
  } catch (error) {
    roadmapMarkdown = `# Стратегия развития\n\n${error.message}`;
  }
  await createAuditApp({
    document,
    window,
    api: initialization.api,
    initializationError: initialization.error,
    roadmapMarkdown,
  }).start();
}

if (typeof document !== 'undefined' && document.querySelector('#roadmap-stage-list')) {
  void bootstrap();
}
