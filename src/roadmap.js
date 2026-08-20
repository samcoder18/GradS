const STAGE_TITLES = [
  'Контент и материалы',
  'Исправления из технического аудита',
  'Новые блоки и формы',
  'Домен',
  'SEO',
  'Аналитика и измерение конверсии',
  'Юридический минимум',
  'Финальное тестирование и запуск',
  'Пост-запуск',
];

export const ROADMAP_STAGES = STAGE_TITLES.map((title, stage) => ({ stage, title }));

export const ROADMAP_ITERATIONS = [
  { iteration: 1, title: 'Быстрые деньги' },
  { iteration: 2, title: 'Доверие и запуск' },
  { iteration: 3, title: 'Рост' },
];

export function roadmapProgress(tasks) {
  const roadmapTasks = tasks.filter((task) => task.track === 'roadmap');
  const total = roadmapTasks.length;
  const completed = roadmapTasks.filter((task) => task.completed).length;
  const open = total - completed;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return { total, completed, open, percent };
}

export function filterRoadmapTasks(tasks, { stage = 'all', status = 'all', search = '' } = {}) {
  const normalizedSearch = String(search).trim().toLocaleLowerCase();
  const normalizedStage = String(stage);

  return tasks.filter((task) => {
    if (task.track !== 'roadmap') return false;
    if (normalizedStage !== 'all' && String(task.roadmap_stage) !== normalizedStage) return false;
    if (status === 'open' && task.completed) return false;
    if (status === 'completed' && !task.completed) return false;
    const searchableText = `${task.title ?? ''} ${task.description ?? ''}`.toLocaleLowerCase();
    return !normalizedSearch || searchableText.includes(normalizedSearch);
  });
}

export function roadmapStageGroups(tasks, stage) {
  const stageTasks = tasks
    .filter((task) => task.track === 'roadmap' && task.roadmap_stage === stage)
    .sort((left, right) => left.position - right.position);
  const iterations = stage === 2 ? [1, 2, 3] : [...new Set(stageTasks.map((task) => task.roadmap_iteration))];

  return iterations.map((iteration) => ({
    iteration,
    tasks: stageTasks.filter((task) => task.roadmap_iteration === iteration),
  }));
}

export function roadmapIterationProgress(tasks, iteration) {
  return roadmapProgress(tasks.filter((task) => task.roadmap_iteration === iteration));
}

export function roadmapStageTitle(stage) {
  return ROADMAP_STAGES.find((item) => item.stage === Number(stage))?.title ?? `Этап ${stage}`;
}
