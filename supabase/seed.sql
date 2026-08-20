create or replace function private.seed_audit_board(p_token_hash bytea)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  seeded_board_id uuid;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception using errcode = '22023', message = 'token hash must be 32 bytes';
  end if;

  insert into public.boards (token_hash)
  values (p_token_hash)
  returning id into seeded_board_id;

  insert into public.tasks (
    board_id, position, title, description, priority, completed, created_by
  ) values
    (seeded_board_id, 1, $task$Убрать «Офис» из публичной навигации или добавить баннер «Демо-данные» на все модули офиса; заменить правдоподобные ФИО руководства.$task$, '', 'P0', false, 'Аудит'),
    (seeded_board_id, 2, $task$Форма партнёрской сети: либо реальный endpoint + согласие на обработку ПДн, либо честный текст «форма в разработке».$task$, '', 'P0', false, 'Аудит'),
    (seeded_board_id, 3, $task$Изображения: `loading="lazy"`, убрать глобальный preload всех 7 вкусов, srcset-варианты, пережать webp (цель: <2 МБ первой загрузки).$task$, '', 'P1', false, 'Аудит'),
    (seeded_board_id, 4, $task$ErrorBoundary вокруг `<Suspense>` офиса и на уровне App.$task$, '', 'P1', false, 'Аудит'),
    (seeded_board_id, 5, $task$Контраст: затемнить градиенты pear/orange/tarragon под белым текстом или сменить цвет текста; добавить скрим под текст мобильного hero.$task$, '', 'P1', false, 'Аудит'),
    (seeded_board_id, 6, $task$Заменить Anton кириллическим дисплейным шрифтом (или применять Anton только к латинским брендам).$task$, '', 'P1', false, 'Аудит'),
    (seeded_board_id, 7, $task$Клавиатура: карта → `<button>`/`role+tabIndex+keydown`, боковые бутылки → tabIndex, меню → `aria-expanded` + Escape, убрать глобальный перехват стрелок (scope на контейнер).$task$, '', 'P1', false, 'Аудит'),
    (seeded_board_id, 8, $task$JSON-LD (Organization + LocalBusiness + Product), `og:type/og:url/canonical`, Twitter Card, `robots.txt`, `sitemap.xml`, `manifest.webmanifest` (иконки уже есть), `404.html`.$task$, '', 'P2', false, 'Аудит'),
    (seeded_board_id, 9, $task$Один h1 (скрытие через условный рендер, не CSS), `<address>`, heading для `#about`, пробелы вокруг inline-картинок в заголовках.$task$, '', 'P2', false, 'Аудит'),
    (seeded_board_id, 10, $task$Удалить GSAP (переписать 2 секции на Motion) или вынести в lazy; `manualChunks`.$task$, '', 'P2', false, 'Аудит'),
    (seeded_board_id, 11, $task$ESLint + Prettier + проверка в CI; `git rm -r --cached assets-src drinks` (или перенести вне репо).$task$, '', 'P2', false, 'Аудит'),
    (seeded_board_id, 12, $task$Убрать позиционную деструктуризацию `hits` — доступ по ключу.$task$, '', 'P2', false, 'Аудит'),
    (seeded_board_id, 13, $task$Вынести easing/nav-links в shared-константы; унифицировать media-query-хук.$task$, '', 'P3', false, 'Аудит'),
    (seeded_board_id, 14, $task$Согласовать географию поставок в текстах; поправить тире в манифесте; единый лейбл CTA-интента заказа.$task$, '', 'P3', false, 'Аудит'),
    (seeded_board_id, 15, $task$Скрыть/пометить `#location` (существует, но ниоткуда не линкуется) — либо добавить в nav.$task$, '', 'P3', false, 'Аудит');

  insert into public.task_events (
    board_id, task_id, event_type, actor, from_completed, to_completed, created_at
  )
  select
    tasks.board_id,
    tasks.id,
    'created',
    'Аудит',
    null,
    false,
    tasks.created_at
  from public.tasks
  where tasks.board_id = seeded_board_id;

  perform private.seed_roadmap_tasks(seeded_board_id);
  perform private.normalize_roadmap_only(seeded_board_id);

  return seeded_board_id;
end;
$$;

revoke all on function private.seed_audit_board(bytea) from public, anon, authenticated, service_role;
