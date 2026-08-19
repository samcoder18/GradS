import {
  auditProgress,
  filterTasks,
  normalizeComment,
  normalizeDisplayName,
  normalizeTaskInput,
  parseBoardToken,
  priorityProgress,
} from './domain.js';
import { createBoardApi, parseAuditReport } from './client.js';

const DISPLAY_NAME_KEY = 'audit-tracker-display-name';
const MUTATION_CONTROL_SELECTOR = [
  '#new-task-form button[type="submit"]',
  '#board-comment-form button[type="submit"]',
  '#task-comment-form button[type="submit"]',
  '[data-complete-task]',
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

function appendEmpty(document, container, text) {
  container.replaceChildren(element(document, 'p', 'empty-state', text));
}

/**
 * Builds the browser client around an injected RPC adapter.
 * The injection keeps DOM behavior testable without making network requests.
 */
export function createAuditApp({
  document,
  window,
  api,
  reportMarkdown = '',
  setIntervalFn = window.setInterval.bind(window),
  clearIntervalFn = window.clearInterval.bind(window),
}) {
  const nodes = {
    status: document.querySelector('#app-status'),
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
    boardComments: document.querySelector('#board-comments'),
    boardCommentCount: document.querySelector('#board-comment-count'),
    boardCommentForm: document.querySelector('#board-comment-form'),
    boardComment: document.querySelector('#board-comment'),
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
      control.disabled = pending;
    }
    for (const form of [nodes.newTaskForm, nodes.boardCommentForm, nodes.taskCommentForm]) {
      form.setAttribute('aria-busy', String(pending));
    }
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

  function renderComments(container, comments, emptyText) {
    container.replaceChildren();
    if (!comments.length) {
      container.append(element(document, 'li', 'empty-state', emptyText));
      return;
    }

    for (const comment of comments) {
      const item = element(document, 'li', 'comment');
      const header = element(document, 'div', 'comment-meta');
      const author = element(document, 'strong', null, comment.author);
      const time = element(document, 'time', null, formatDate(comment.created_at));
      time.dateTime = comment.created_at;
      const body = element(document, 'p', null, comment.body);
      header.append(author, time);
      item.append(header, body);
      container.append(item);
    }
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
    nodes.drawerCompleted.disabled = mutationPending;
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
    renderComments(nodes.taskComments, task.comments, 'Комментариев пока нет.');
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
      checkbox.disabled = mutationPending;
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
    renderComments(nodes.boardComments, board.comments, 'В общем чате пока тихо.');
    renderDrawer();
  }

  function renderReport() {
    const report = parseAuditReport(reportMarkdown);
    const title = document.querySelector('#report-title');
    const introduction = document.querySelector('#report-introduction');
    const navigation = document.querySelector('#report-navigation');
    const disclosures = document.querySelector('#report-disclosures');
    title.textContent = report.title || 'Технический аудит';
    introduction.textContent = report.introduction;
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
      const summary = element(document, 'summary', null, section.title);
      const body = element(document, 'pre', 'report-body', section.body);
      details.append(summary, body);
      disclosures.append(details);
    }
    navigation.append(navList);
  }

  async function refresh({ silent = false } = {}) {
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
    if (mutationPending) return false;
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

    nodes.boardCommentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = normalizeComment(nodes.boardComment.value);
      nodes.boardCommentError.textContent = result.valid ? '' : result.error;
      if (!result.valid) return;
      const saved = await performMutation((author) => api.addBoardComment({ author, body: result.value }));
      if (saved) nodes.boardCommentForm.reset();
    });
    nodes.taskCommentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = normalizeComment(nodes.taskComment.value);
      nodes.taskCommentError.textContent = result.valid ? '' : result.error;
      if (!result.valid || !selectedTaskId) return;
      const taskId = selectedTaskId;
      const saved = await performMutation((author) => api.addTaskComment({ author, taskId, body: result.value }));
      if (saved) nodes.taskCommentForm.reset();
    });

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
      window.addEventListener('focus', handleFocus);
      document.addEventListener('keydown', handleDocumentKeydown);
      await refresh();
      intervalId = setIntervalFn(() => refresh({ silent: true }), 20_000);
    },
    stop() {
      if (!started) return;
      started = false;
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('keydown', handleDocumentKeydown);
      if (intervalId !== null) clearIntervalFn(intervalId);
      intervalId = null;
    },
    refresh,
  };
}

async function bootstrap() {
  const reportPromise = fetch(new URL('../audit-report.md', import.meta.url)).then((response) => {
    if (!response.ok) throw new Error('Не удалось загрузить файл отчёта.');
    return response.text();
  });
  let api;
  try {
    const token = parseBoardToken(window.location.hash);
    if (!token) throw new Error('В ссылке нет корректного токена доски.');
    const [{ createClient }, config] = await Promise.all([
      import('@supabase/supabase-js'),
      import('./config.js').catch(() => {
        throw new Error('Добавьте публичные настройки Supabase в src/config.js.');
      }),
    ]);
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || config.SUPABASE_URL.includes('YOUR_PROJECT')) {
      throw new Error('Добавьте публичные настройки Supabase в src/config.js.');
    }
    api = createBoardApi(createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY), token);
  } catch (error) {
    api = { snapshot: async () => { throw error; } };
  }

  let reportMarkdown = '';
  try {
    reportMarkdown = await reportPromise;
  } catch (error) {
    reportMarkdown = `# Технический аудит\n\n${error.message}`;
  }
  await createAuditApp({ document, window, api, reportMarkdown }).start();
}

if (typeof document !== 'undefined' && document.querySelector('#task-list')) {
  void bootstrap();
}
