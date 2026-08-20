alter table public.tasks
  add column track text not null default 'audit',
  add column roadmap_stage smallint,
  add column roadmap_iteration smallint,
  add column completion_mode text not null default 'manual',
  add column seed_key text;

alter table public.tasks alter column priority drop not null;
alter table public.tasks drop constraint tasks_priority_value;
alter table public.tasks drop constraint tasks_title_length;
alter table public.tasks
  add constraint tasks_priority_value check (priority is null or priority in ('P0', 'P1', 'P2', 'P3')),
  add constraint tasks_title_length check (char_length(btrim(title)) between 1 and 1000),
  add constraint tasks_track_value check (track in ('audit', 'roadmap')),
  add constraint tasks_completion_mode_value check (completion_mode in ('manual', 'derived')),
  add constraint tasks_track_metadata_shape check (
    (track = 'audit'
      and priority is not null
      and roadmap_stage is null
      and roadmap_iteration is null
      and completion_mode = 'manual')
    or
    (track = 'roadmap'
      and priority is null
      and roadmap_stage between 0 and 8
      and roadmap_iteration between 1 and 3)
  ),
  add constraint tasks_board_seed_key_key unique (board_id, seed_key);

create index tasks_board_track_stage_position_idx
  on public.tasks (board_id, track, roadmap_stage, roadmap_iteration, position);

create table public.task_audit_links (
  board_id uuid not null,
  roadmap_task_id uuid not null,
  audit_task_id uuid not null,
  primary key (board_id, roadmap_task_id, audit_task_id),
  constraint task_audit_links_distinct_tasks check (roadmap_task_id <> audit_task_id),
  constraint task_audit_links_roadmap_task_fkey foreign key (board_id, roadmap_task_id)
    references public.tasks(board_id, id) on delete cascade,
  constraint task_audit_links_audit_task_fkey foreign key (board_id, audit_task_id)
    references public.tasks(board_id, id) on delete cascade
);

create index task_audit_links_roadmap_idx
  on public.task_audit_links (board_id, roadmap_task_id, audit_task_id);

alter table public.task_audit_links enable row level security;
revoke all on public.task_audit_links from public, anon, authenticated;
grant all on public.task_audit_links to service_role;

create or replace function private.validate_task_audit_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  roadmap_track text;
  roadmap_completion_mode text;
  audit_track text;
begin
  select tasks.track, tasks.completion_mode
    into roadmap_track, roadmap_completion_mode
    from public.tasks
   where tasks.board_id = new.board_id
     and tasks.id = new.roadmap_task_id;

  select tasks.track
    into audit_track
    from public.tasks
   where tasks.board_id = new.board_id
     and tasks.id = new.audit_task_id;

  if roadmap_track <> 'roadmap' or roadmap_completion_mode <> 'derived' then
    raise exception using errcode = '22023', message = 'roadmap links require a derived roadmap task';
  end if;
  if audit_track <> 'audit' then
    raise exception using errcode = '22023', message = 'roadmap links must target audit tasks';
  end if;

  return new;
end;
$$;

create trigger task_audit_links_validate
before insert or update on public.task_audit_links
for each row execute function private.validate_task_audit_link();

create trigger task_audit_links_immutable
before update or delete on public.task_audit_links
for each row execute function private.reject_immutable_change();

create or replace function private.roadmap_iteration_is_valid(
  stage smallint,
  iteration smallint
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case stage
    when 0 then iteration = 2
    when 1 then iteration = 1
    when 2 then iteration between 1 and 3
    when 3 then iteration = 2
    when 4 then iteration = 2
    when 5 then iteration = 2
    when 6 then iteration = 2
    when 7 then iteration = 2
    when 8 then iteration = 3
    else false
  end;
$$;

create or replace function private.seed_roadmap_tasks(p_board_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  first_position integer;
begin
  if not exists (select 1 from public.boards where boards.id = p_board_id) then
    raise exception using errcode = 'P0002', message = 'board not found';
  end if;

  perform 1 from public.boards where boards.id = p_board_id for update;
  select coalesce(max(tasks.position), 0) into first_position
    from public.tasks
   where tasks.board_id = p_board_id;

  with roadmap_spec(seed_key, ordinal, roadmap_stage, roadmap_iteration, completion_mode, title) as (
    values
      ('roadmap-0-01', 1, 0::smallint, 2::smallint, 'manual', 'Получить от клиента реальные цифры: ценовые тиеры, MOQ, фасовка (шт/короб), сроки отгрузки, география, отсрочка платежа.'),
      ('roadmap-0-02', 2, 0::smallint, 2::smallint, 'manual', 'Реквизиты юрлица: ИНН, ОГРН, юр. и фактический адрес.'),
      ('roadmap-0-03', 3, 0::smallint, 2::smallint, 'manual', 'Документы: декларации ЕАС, ТУ/ГОСТ, анализы воды (PDF для скачивания).'),
      ('roadmap-0-04', 4, 0::smallint, 2::smallint, 'manual', 'Фотосессия: производство (цех, линия розлива, склад), команда (если идёт в публичную часть), точки продаж клиентов.'),
      ('roadmap-0-05', 5, 0::smallint, 2::smallint, 'manual', 'Собрать разрешения и логотипы клиентов для блока соц. доказательства.'),
      ('roadmap-0-06', 6, 0::smallint, 2::smallint, 'manual', 'Утвердить финальные тексты (включая исправления из AUDIT.md §8: тире, география, подписи к цифрам).'),
      ('roadmap-1-01', 7, 1::smallint, 1::smallint, 'derived', 'P0: форма офиса перестаёт врать про «заявку принята» (для публичной формы — рабочий endpoint).'),
      ('roadmap-1-02', 8, 1::smallint, 1::smallint, 'derived', 'P1: производительность — lazy-загрузка изображений, srcset-варианты, пережать webp, удалить/разделить GSAP, `manualChunks`. Цель: <2 МБ первой загрузки.'),
      ('roadmap-1-03', 9, 1::smallint, 1::smallint, 'derived', 'P1: ErrorBoundary, контрасты (WCAG AA), keyboard-доступность (карта, карусель, меню).'),
      ('roadmap-1-04', 10, 1::smallint, 1::smallint, 'derived', 'P1: кириллический дисплейный шрифт вместо Anton на русском тексте.'),
      ('roadmap-1-05', 11, 1::smallint, 1::smallint, 'derived', 'P2: один h1, `<address>`, заголовок у `#about`, пробелы в именах заголовков с inline-картинками.'),
      ('roadmap-1-06', 12, 1::smallint, 1::smallint, 'derived', 'Очистка репозитория: убрать `assets-src/` и `drinks/` из git, добавить `README.md`, `LICENSE` (если нужна).'),
      ('roadmap-2-01', 13, 2::smallint, 1::smallint, 'manual', 'Блок «Условия для опта» (P1-1).'),
      ('roadmap-2-02', 14, 2::smallint, 1::smallint, 'manual', 'Форма заявки + endpoint + согласие ПДн (P1-2).'),
      ('roadmap-2-03', 15, 2::smallint, 1::smallint, 'manual', 'FAQ + микроразметка FAQPage (P1-3).'),
      ('roadmap-2-04', 16, 2::smallint, 2::smallint, 'manual', 'Социальное доказательство (P2-1) — по готовности материалов.'),
      ('roadmap-2-05', 17, 2::smallint, 2::smallint, 'manual', 'Блок «Качество и производство» (P2-2).'),
      ('roadmap-2-06', 18, 2::smallint, 1::smallint, 'manual', 'Sticky-CTA + WhatsApp-кнопка (P3-3).'),
      ('roadmap-2-07', 19, 2::smallint, 1::smallint, 'manual', 'Реквизиты и политика ПДн в футере.'),
      ('roadmap-2-08', 20, 2::smallint, 3::smallint, 'manual', 'Опционально: калькулятор маржи (P3-1), квиз (P3-2).'),
      ('roadmap-3-01', 21, 3::smallint, 2::smallint, 'manual', 'Выбрать и купить домен (рекомендация: короткий `.ru`, бренд + категория, напр. `sladkiy-grad.ru` / `sg-napitki.ru` — проверить свободность и отсутствие конфликтов товарных знаков; зеркально `.рф` по желанию).'),
      ('roadmap-3-02', 22, 3::smallint, 2::smallint, 'manual', 'Регистратор: любой российский (REG.RU, Timeweb, Selectel). Домен на юрлицо клиента, не на разработчика.'),
      ('roadmap-3-03', 23, 3::smallint, 2::smallint, 'manual', 'Подключение к GitHub Pages: A-записи на IP GitHub (`185.199.108.153`–`185.199.111.153`) + CNAME `www` → `samcoder18.github.io`, файл `CNAME` в `public/`.'),
      ('roadmap-3-04', 24, 3::smallint, 2::smallint, 'manual', 'После переезда на свой домен: убрать `base: "/Grad/"` из `vite.config.js` (сайт будет в корне), обновить `og:image` и все абсолютные URL на новый домен.'),
      ('roadmap-3-05', 25, 3::smallint, 2::smallint, 'manual', 'Включить HTTPS (Enforce HTTPS в настройках Pages — Let''s Encrypt выдаётся автоматически).'),
      ('roadmap-3-06', 26, 3::smallint, 2::smallint, 'manual', 'Редирект `www` → основной (или наоборот — выбрать один canonical-вариант).'),
      ('roadmap-3-07', 27, 3::smallint, 2::smallint, 'manual', 'Почта на домене (Яндекс 360 / VK WorkMail): `zakup@`, `info@` — письма с `gudis_goodies@mail.ru` подрывают престиж; заменить на сайте и в подписи форм.'),
      ('roadmap-4-01', 28, 4::smallint, 2::smallint, 'manual', 'Техническая база: `robots.txt`, `sitemap.xml`, canonical, `og:type/og:url/og:locale`, Twitter Card, `manifest.webmanifest`, `404.html`.'),
      ('roadmap-4-02', 29, 4::smallint, 2::smallint, 'manual', 'JSON-LD: `Organization` + `LocalBusiness` (адрес, телефон, geo) + `Product` (линейка) + `FAQPage` (после блока FAQ).'),
      ('roadmap-4-03', 30, 4::smallint, 2::smallint, 'manual', 'Семантика: собрать запросы («лимонад оптом от производителя», «вода опт Владикавказ», «Гудис вода купить оптом» и т.п.) — вшить в title/H1/H2/тексты естественно, без переспама.'),
      ('roadmap-4-04', 31, 4::smallint, 2::smallint, 'manual', 'Title/description под новый домен и семантику; og:image 1200×630 на новом домене.'),
      ('roadmap-4-05', 32, 4::smallint, 2::smallint, 'manual', 'Регистрация: Яндекс.Вебмастер + Google Search Console, подтверждение, отправка sitemap, переезд (если сайт уже индексировался на github.io — запрос на переезд/каноникализация).'),
      ('roadmap-4-06', 33, 4::smallint, 2::smallint, 'manual', 'Яндекс.Бизнес и 2ГИС: карточка производства (адрес, часы, фото, сайт) — бесплатный трафик и доверие; ссылка «мы на картах» в LocationSection.'),
      ('roadmap-4-07', 34, 4::smallint, 2::smallint, 'manual', 'Яндекс.Дзен/соцсети — только если есть ресурс на ведение.'),
      ('roadmap-5-01', 35, 5::smallint, 2::smallint, 'manual', 'Яндекс.Метрика: счётчик, Вебвизор, карта кликов, аналитика форм.'),
      ('roadmap-5-02', 36, 5::smallint, 2::smallint, 'manual', 'Цели: отправка формы, клик по телефону, клик по WhatsApp, клик по почте, скачивание прайса/PDF, прохождение квиза.'),
      ('roadmap-5-03', 37, 5::smallint, 2::smallint, 'manual', 'UTM-разметка для будущих рекламных каналов.'),
      ('roadmap-5-04', 38, 5::smallint, 2::smallint, 'manual', '(Опционально) Google Analytics 4 как дубль.'),
      ('roadmap-5-05', 39, 5::smallint, 2::smallint, 'manual', 'Согласие на cookies в политике ПДн (баннер по желанию/рискам).'),
      ('roadmap-6-01', 40, 6::smallint, 2::smallint, 'manual', 'Политика конфиденциальности (152-ФЗ) — отдельная страница, ссылка из формы и футера.'),
      ('roadmap-6-02', 41, 6::smallint, 2::smallint, 'manual', 'Согласие на обработку ПДн — чекбокс в форме.'),
      ('roadmap-6-03', 42, 6::smallint, 2::smallint, 'manual', 'Реквизиты на сайте (уже в этапе 2).'),
      ('roadmap-6-04', 43, 6::smallint, 2::smallint, 'manual', 'Проверка товарного знака «Сладкий Град» / «Gudis» (регистрация ТМ — клиенту; влияет на доменную стратегию).'),
      ('roadmap-7-01', 44, 7::smallint, 2::smallint, 'manual', 'Кроссбраузерность: Chrome, Safari, Firefox, Edge + iOS Safari, Android Chrome.'),
      ('roadmap-7-02', 45, 7::smallint, 2::smallint, 'manual', 'Устройства: 360/375/768/1024/1440/1920; проверка отсутствия горизонтального скролла.'),
      ('roadmap-7-03', 46, 7::smallint, 2::smallint, 'manual', 'Lighthouse: Performance ≥85 мобайл, Accessibility ≥95, SEO ≥95, Best Practices ≥95.'),
      ('roadmap-7-04', 47, 7::smallint, 2::smallint, 'manual', 'Проверка форм end-to-end (заявка реально доходит, автоответ корректен).'),
      ('roadmap-7-05', 48, 7::smallint, 2::smallint, 'manual', 'Проверка tel:/mailto:/wa.me с реального телефона.'),
      ('roadmap-7-06', 49, 7::smallint, 2::smallint, 'manual', 'Проверка og:image через отладчики (Telegram, VK, WhatsApp link preview).'),
      ('roadmap-7-07', 50, 7::smallint, 2::smallint, 'manual', 'Нагрузочное не нужно (статика), но проверить Time-to-first-byte на хостинге из РФ (GitHub Pages из РФ может быть медленным/нестабильным — рассмотреть переезд на российский статик-хостинг: Timeweb, Selectel, Yandex Cloud Object Storage + CDN; для .ru-домена и B2B-аудитории РФ это правильнее).'),
      ('roadmap-7-08', 51, 7::smallint, 2::smallint, 'manual', 'Мониторинг: uptime-чекер (uptimerobot и аналоги), алерт в Telegram.'),
      ('roadmap-8-01', 52, 8::smallint, 3::smallint, 'manual', 'Смотреть Метрику: отказы, глубина, карта кликов, запись сессий по форме.'),
      ('roadmap-8-02', 53, 8::smallint, 3::smallint, 'manual', 'A/B или последовательные итерации: заголовок hero, лейбл CTA, порядок блока «Условия».'),
      ('roadmap-8-03', 54, 8::smallint, 3::smallint, 'manual', 'Докрутить SEO по фактическим запросам из Вебмастера.'),
      ('roadmap-8-04', 55, 8::smallint, 3::smallint, 'manual', 'Собрать первые реальные кейсы/логотипы → усилить блок соц. доказательства.'),
      ('roadmap-8-05', 56, 8::smallint, 3::smallint, 'manual', 'Ежемесячно: обновлять цифры (точек продаж, городов), фото, документы.')
  ), inserted as (
    insert into public.tasks (
      board_id, position, title, description, priority, track, roadmap_stage,
      roadmap_iteration, completion_mode, completed, created_by, seed_key
    )
    select
      p_board_id,
      first_position + roadmap_spec.ordinal,
      roadmap_spec.title,
      '',
      null,
      'roadmap',
      roadmap_spec.roadmap_stage,
      roadmap_spec.roadmap_iteration,
      roadmap_spec.completion_mode,
      false,
      'Roadmap',
      roadmap_spec.seed_key
    from roadmap_spec
    on conflict (board_id, seed_key) do nothing
    returning *
  )
  insert into public.task_events (
    board_id, task_id, event_type, actor, from_completed, to_completed, created_at
  )
  select board_id, id, 'created', 'Roadmap', null, false, created_at
  from inserted;

  insert into public.task_audit_links (board_id, roadmap_task_id, audit_task_id)
  select
    p_board_id,
    roadmap_tasks.id,
    audit_tasks.id
  from (
    values
      ('roadmap-1-01'::text, 1),
      ('roadmap-1-01'::text, 2),
      ('roadmap-1-02'::text, 3),
      ('roadmap-1-02'::text, 10),
      ('roadmap-1-03'::text, 4),
      ('roadmap-1-03'::text, 5),
      ('roadmap-1-03'::text, 7),
      ('roadmap-1-04'::text, 6),
      ('roadmap-1-05'::text, 9),
      ('roadmap-1-06'::text, 11)
  ) as links(roadmap_seed_key, audit_position)
  join public.tasks as roadmap_tasks
    on roadmap_tasks.board_id = p_board_id
   and roadmap_tasks.seed_key = links.roadmap_seed_key
  join public.tasks as audit_tasks
    on audit_tasks.board_id = p_board_id
   and audit_tasks.track = 'audit'
   and audit_tasks.position = links.audit_position
  on conflict do nothing;
end;
$$;

create or replace function public.board_snapshot(token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  selected_board_id uuid := private.board_for_token(board_snapshot.token);
begin
  return jsonb_build_object(
    'board', (
      select jsonb_build_object('id', boards.id, 'created_at', boards.created_at)
      from public.boards
      where boards.id = selected_board_id
    ),
    'tasks', coalesce((
      select jsonb_agg(task_json order by task_sort.track_order, task_sort.roadmap_stage, task_sort.roadmap_iteration, task_sort.position)
      from (
        select
          case when tasks.track = 'audit' then 0 else 1 end as track_order,
          coalesce(tasks.roadmap_stage, -1) as roadmap_stage,
          coalesce(tasks.roadmap_iteration, 0) as roadmap_iteration,
          tasks.position,
          jsonb_build_object(
            'id', tasks.id,
            'position', tasks.position,
            'title', tasks.title,
            'description', tasks.description,
            'priority', tasks.priority,
            'track', tasks.track,
            'roadmap_stage', tasks.roadmap_stage,
            'roadmap_iteration', tasks.roadmap_iteration,
            'completion_mode', tasks.completion_mode,
            'completed', case
              when tasks.completion_mode = 'derived' then coalesce((
                select bool_and(audit_tasks.completed)
                from public.task_audit_links
                join public.tasks as audit_tasks
                  on audit_tasks.board_id = task_audit_links.board_id
                 and audit_tasks.id = task_audit_links.audit_task_id
                where task_audit_links.board_id = selected_board_id
                  and task_audit_links.roadmap_task_id = tasks.id
              ), false)
              else tasks.completed
            end,
            'created_by', tasks.created_by,
            'created_at', tasks.created_at,
            'updated_at', tasks.updated_at,
            'audit_links', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', audit_tasks.id,
                  'title', audit_tasks.title,
                  'priority', audit_tasks.priority,
                  'completed', audit_tasks.completed
                ) order by audit_tasks.position
              )
              from public.task_audit_links
              join public.tasks as audit_tasks
                on audit_tasks.board_id = task_audit_links.board_id
               and audit_tasks.id = task_audit_links.audit_task_id
              where task_audit_links.board_id = selected_board_id
                and task_audit_links.roadmap_task_id = tasks.id
            ), '[]'::jsonb),
            'events', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', task_events.id,
                  'event_type', task_events.event_type,
                  'actor', task_events.actor,
                  'from_completed', task_events.from_completed,
                  'to_completed', task_events.to_completed,
                  'created_at', task_events.created_at
                ) order by task_events.created_at, task_events.id
              )
              from public.task_events
              where task_events.board_id = selected_board_id
                and task_events.task_id = tasks.id
            ), '[]'::jsonb),
            'comments', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', task_comments.id,
                  'author', task_comments.author,
                  'body', task_comments.body,
                  'created_at', task_comments.created_at
                ) order by task_comments.created_at, task_comments.id
              )
              from public.task_comments
              where task_comments.board_id = selected_board_id
                and task_comments.task_id = tasks.id
            ), '[]'::jsonb)
          ) as task_json
        from public.tasks
        where tasks.board_id = selected_board_id
      ) as task_sort
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', board_comments.id,
          'author', board_comments.author,
          'body', board_comments.body,
          'created_at', board_comments.created_at
        ) order by board_comments.created_at, board_comments.id
      )
      from public.board_comments
      where board_comments.board_id = selected_board_id
    ), '[]'::jsonb)
  );
end;
$$;

drop function public.create_task(text, text, text, text, text);

create function public.create_task(
  token text,
  author text,
  title text,
  description text,
  priority text,
  track text,
  roadmap_stage smallint,
  roadmap_iteration smallint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  selected_board_id uuid := private.board_for_token(create_task.token);
  normalized_author text := btrim(create_task.author);
  normalized_title text := btrim(create_task.title);
  normalized_description text := btrim(coalesce(create_task.description, ''));
  normalized_track text := lower(btrim(create_task.track));
  new_position integer;
  new_task public.tasks%rowtype;
begin
  if normalized_author is null or char_length(normalized_author) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'author must be 1 to 80 characters';
  end if;
  if normalized_title is null or char_length(normalized_title) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'title must be 1 to 200 characters';
  end if;
  if char_length(normalized_description) > 4000 then
    raise exception using errcode = '22023', message = 'description must be at most 4000 characters';
  end if;
  if normalized_track = 'audit' then
    if create_task.priority is null or create_task.priority not in ('P0', 'P1', 'P2', 'P3') then
      raise exception using errcode = '22023', message = 'audit priority must be P0, P1, P2, or P3';
    end if;
    if create_task.roadmap_stage is not null or create_task.roadmap_iteration is not null then
      raise exception using errcode = '22023', message = 'audit tasks cannot have roadmap metadata';
    end if;
  elsif normalized_track = 'roadmap' then
    if create_task.priority is not null then
      raise exception using errcode = '22023', message = 'roadmap tasks do not have a priority';
    end if;
    if create_task.roadmap_stage is null or create_task.roadmap_stage not between 0 and 8 then
      raise exception using errcode = '22023', message = 'roadmap stage must be between 0 and 8';
    end if;
    if not private.roadmap_iteration_is_valid(create_task.roadmap_stage, create_task.roadmap_iteration) then
      raise exception using errcode = '22023', message = 'roadmap iteration is not valid for this stage';
    end if;
  else
    raise exception using errcode = '22023', message = 'track must be audit or roadmap';
  end if;

  perform 1 from public.boards where boards.id = selected_board_id for update;
  select coalesce(max(tasks.position), 0) + 1
    into new_position
    from public.tasks
   where tasks.board_id = selected_board_id;

  insert into public.tasks (
    board_id, position, title, description, priority, track, roadmap_stage,
    roadmap_iteration, completion_mode, completed, created_by
  ) values (
    selected_board_id,
    new_position,
    normalized_title,
    normalized_description,
    case when normalized_track = 'audit' then create_task.priority else null end,
    normalized_track,
    case when normalized_track = 'roadmap' then create_task.roadmap_stage else null end,
    case when normalized_track = 'roadmap' then create_task.roadmap_iteration else null end,
    'manual',
    false,
    normalized_author
  ) returning * into new_task;

  insert into public.task_events (board_id, task_id, event_type, actor, from_completed, to_completed)
  values (selected_board_id, new_task.id, 'created', normalized_author, null, false);

  return jsonb_build_object(
    'id', new_task.id,
    'position', new_task.position,
    'title', new_task.title,
    'description', new_task.description,
    'priority', new_task.priority,
    'track', new_task.track,
    'roadmap_stage', new_task.roadmap_stage,
    'roadmap_iteration', new_task.roadmap_iteration,
    'completion_mode', new_task.completion_mode,
    'completed', new_task.completed,
    'created_by', new_task.created_by,
    'created_at', new_task.created_at,
    'updated_at', new_task.updated_at
  );
end;
$$;

create or replace function public.set_task_completed(
  token text,
  author text,
  task_id uuid,
  completed boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  selected_board_id uuid := private.board_for_token(set_task_completed.token);
  normalized_author text := btrim(set_task_completed.author);
  existing_completed boolean;
  existing_completion_mode text;
  changed_at timestamptz;
begin
  if normalized_author is null or char_length(normalized_author) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'author must be 1 to 80 characters';
  end if;
  if set_task_completed.task_id is null or set_task_completed.completed is null then
    raise exception using errcode = '22023', message = 'task_id and completed are required';
  end if;

  select tasks.completed, tasks.completion_mode
    into existing_completed, existing_completion_mode
    from public.tasks
   where tasks.board_id = selected_board_id
     and tasks.id = set_task_completed.task_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if existing_completion_mode = 'derived' then
    raise exception using errcode = '22023', message = 'derived roadmap task status is managed by audit links';
  end if;

  if existing_completed <> set_task_completed.completed then
    changed_at := clock_timestamp();
    update public.tasks
       set completed = set_task_completed.completed,
           updated_at = changed_at
     where tasks.board_id = selected_board_id
       and tasks.id = set_task_completed.task_id;

    insert into public.task_events (
      board_id, task_id, event_type, actor, from_completed, to_completed, created_at
    ) values (
      selected_board_id,
      set_task_completed.task_id,
      'completion_changed',
      normalized_author,
      existing_completed,
      set_task_completed.completed,
      changed_at
    );
  end if;

  return (
    select jsonb_build_object('id', tasks.id, 'completed', tasks.completed, 'updated_at', tasks.updated_at)
    from public.tasks
    where tasks.board_id = selected_board_id
      and tasks.id = set_task_completed.task_id
  );
end;
$$;

revoke all on function private.validate_task_audit_link() from public, anon, authenticated;
revoke all on function private.roadmap_iteration_is_valid(smallint, smallint) from public, anon, authenticated;
revoke all on function private.seed_roadmap_tasks(uuid) from public, anon, authenticated;

revoke all on function public.create_task(text, text, text, text, text, text, smallint, smallint) from public, anon, authenticated;
grant execute on function public.create_task(text, text, text, text, text, text, smallint, smallint) to anon, authenticated;

select private.seed_roadmap_tasks(boards.id)
from public.boards;
