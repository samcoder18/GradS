begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to anon;

select plan(85);

select has_table('public', 'boards', 'boards table exists');
select has_table('public', 'tasks', 'tasks table exists');
select has_table('public', 'task_events', 'task events table exists');
select has_table('public', 'task_comments', 'task comments table exists');
select has_table('public', 'board_comments', 'board comments table exists');
select has_table('public', 'comment_reactions', 'comment reactions table exists');
select ok(
  (
    select count(*) = 4
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('task_comments', 'board_comments')
      and column_name in ('parent_comment_id', 'attachments')
  ),
  'both comment tables expose reply and attachment metadata'
);
select has_table('public', 'task_audit_links', 'roadmap audit links table exists');

select ok((select relrowsecurity from pg_class where oid = 'public.boards'::regclass), 'boards uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), 'tasks uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.task_events'::regclass), 'task events use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.task_comments'::regclass), 'task comments use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.board_comments'::regclass), 'board comments use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.task_audit_links'::regclass), 'roadmap audit links use RLS');

select ok(not has_table_privilege('anon', 'public.boards', 'SELECT'), 'anon cannot select boards');
select ok(not has_table_privilege('anon', 'public.tasks', 'INSERT'), 'anon cannot insert tasks directly');
select ok(not has_table_privilege('anon', 'public.task_comments', 'UPDATE'), 'anon cannot edit comments directly');
select ok(not has_table_privilege('authenticated', 'public.board_comments', 'DELETE'), 'authenticated cannot delete comments directly');
select ok(not has_table_privilege('anon', 'public.task_audit_links', 'SELECT'), 'anon cannot read roadmap audit links directly');

select has_function('public', 'board_snapshot', array['text'], 'board_snapshot RPC exists');
select has_function('public', 'create_task', array['text', 'text', 'text', 'text', 'text', 'text', 'smallint', 'smallint'], 'create_task RPC exists');
select has_function('public', 'set_task_completed', array['text', 'text', 'uuid', 'boolean'], 'set_task_completed RPC exists');
select has_function('public', 'add_task_comment', array['text', 'text', 'uuid', 'text'], 'add_task_comment RPC exists');
select has_function('public', 'add_board_comment', array['text', 'text', 'text'], 'add_board_comment RPC exists');
select has_function('public', 'add_board_message', array['text', 'text', 'text', 'uuid', 'jsonb'], 'add_board_message RPC exists');
select has_function('public', 'add_task_message', array['text', 'text', 'uuid', 'text', 'uuid', 'jsonb'], 'add_task_message RPC exists');
select has_function('public', 'toggle_comment_reaction', array['text', 'text', 'uuid', 'text'], 'toggle_comment_reaction RPC exists');

select ok(
  (select prosecdef from pg_proc where oid = 'public.board_snapshot(text)'::regprocedure),
  'board_snapshot is security definer'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.create_task(text,text,text,text,text,text,smallint,smallint)'::regprocedure),
  'create_task is security definer'
);
select is(
  (
    select count(*)::integer
    from pg_proc
    where oid in (
      'public.board_snapshot(text)'::regprocedure,
      'public.create_task(text,text,text,text,text,text,smallint,smallint)'::regprocedure,
      'public.set_task_completed(text,text,uuid,boolean)'::regprocedure,
      'public.add_task_comment(text,text,uuid,text)'::regprocedure,
      'public.add_board_comment(text,text,text)'::regprocedure
    )
      and prosecdef
      and proconfig @> array['search_path=pg_catalog']
  ),
  5,
  'all public RPCs are security definer functions with a fixed search path'
);
select ok(has_function_privilege('anon', 'public.board_snapshot(text)', 'EXECUTE'), 'anon can execute board_snapshot');
select ok(has_function_privilege('anon', 'public.create_task(text,text,text,text,text,text,smallint,smallint)', 'EXECUTE'), 'anon can execute create_task');
select ok(has_function_privilege('anon', 'public.set_task_completed(text,text,uuid,boolean)', 'EXECUTE'), 'anon can execute set_task_completed');
select ok(has_function_privilege('anon', 'public.add_task_comment(text,text,uuid,text)', 'EXECUTE'), 'anon can execute add_task_comment');
select ok(has_function_privilege('anon', 'public.add_board_comment(text,text,text)', 'EXECUTE'), 'anon can execute add_board_comment');

select private.seed_audit_board(extensions.digest(convert_to('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M', 'UTF8'), 'sha256'));

select is((select count(*)::integer from public.boards), 1, 'seed creates one board');
select is(
  (select encode(token_hash, 'hex') from public.boards),
  encode(extensions.digest(convert_to('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M', 'UTF8'), 'sha256'), 'hex'),
  'board stores exactly the SHA-256 token hash'
);
select is((select count(*)::integer from public.tasks), 71, 'seed creates 15 audit and 56 roadmap tasks');
select results_eq(
  $$select priority, count(*)::bigint from public.tasks where track = 'audit' group by priority order by priority$$,
  $$values ('P0'::text, 2::bigint), ('P1'::text, 5::bigint), ('P2'::text, 5::bigint), ('P3'::text, 3::bigint)$$,
  'seed preserves P0-P3 grouping'
);
select results_eq(
  $$select position, title, priority from public.tasks where track = 'audit' order by position$$,
  $$values
    (1, 'Убрать «Офис» из публичной навигации или добавить баннер «Демо-данные» на все модули офиса; заменить правдоподобные ФИО руководства.'::text, 'P0'::text),
    (2, 'Форма партнёрской сети: либо реальный endpoint + согласие на обработку ПДн, либо честный текст «форма в разработке».'::text, 'P0'::text),
    (3, 'Изображения: `loading="lazy"`, убрать глобальный preload всех 7 вкусов, srcset-варианты, пережать webp (цель: <2 МБ первой загрузки).'::text, 'P1'::text),
    (4, 'ErrorBoundary вокруг `<Suspense>` офиса и на уровне App.'::text, 'P1'::text),
    (5, 'Контраст: затемнить градиенты pear/orange/tarragon под белым текстом или сменить цвет текста; добавить скрим под текст мобильного hero.'::text, 'P1'::text),
    (6, 'Заменить Anton кириллическим дисплейным шрифтом (или применять Anton только к латинским брендам).'::text, 'P1'::text),
    (7, 'Клавиатура: карта → `<button>`/`role+tabIndex+keydown`, боковые бутылки → tabIndex, меню → `aria-expanded` + Escape, убрать глобальный перехват стрелок (scope на контейнер).'::text, 'P1'::text),
    (8, 'JSON-LD (Organization + LocalBusiness + Product), `og:type/og:url/canonical`, Twitter Card, `robots.txt`, `sitemap.xml`, `manifest.webmanifest` (иконки уже есть), `404.html`.'::text, 'P2'::text),
    (9, 'Один h1 (скрытие через условный рендер, не CSS), `<address>`, heading для `#about`, пробелы вокруг inline-картинок в заголовках.'::text, 'P2'::text),
    (10, 'Удалить GSAP (переписать 2 секции на Motion) или вынести в lazy; `manualChunks`.'::text, 'P2'::text),
    (11, 'ESLint + Prettier + проверка в CI; `git rm -r --cached assets-src drinks` (или перенести вне репо).'::text, 'P2'::text),
    (12, 'Убрать позиционную деструктуризацию `hits` — доступ по ключу.'::text, 'P2'::text),
    (13, 'Вынести easing/nav-links в shared-константы; унифицировать media-query-хук.'::text, 'P3'::text),
    (14, 'Согласовать географию поставок в текстах; поправить тире в манифесте; единый лейбл CTA-интента заказа.'::text, 'P3'::text),
    (15, 'Скрыть/пометить `#location` (существует, но ниоткуда не линкуется) — либо добавить в nav.'::text, 'P3'::text)$$,
  'seed preserves every roadmap task verbatim and in order'
);
select is((select count(*)::integer from public.task_events where event_type = 'created'), 71, 'seed records creation events');
select is((select count(*)::integer from public.tasks where track = 'audit'), 15, 'seed preserves 15 audit tasks');
select is((select count(*)::integer from public.tasks where track = 'roadmap'), 56, 'seed imports 56 roadmap tasks');
select results_eq(
  $$select roadmap_stage, count(*)::bigint from public.tasks where track = 'roadmap' group by roadmap_stage order by roadmap_stage$$,
  $$values (0::smallint, 6::bigint), (1::smallint, 6::bigint), (2::smallint, 8::bigint), (3::smallint, 7::bigint), (4::smallint, 7::bigint), (5::smallint, 5::bigint), (6::smallint, 4::bigint), (7::smallint, 8::bigint), (8::smallint, 5::bigint)$$,
  'roadmap seed preserves the checklist count for every stage'
);
select results_eq(
  $$select roadmap_iteration, count(*)::bigint from public.tasks where track = 'roadmap' group by roadmap_iteration order by roadmap_iteration$$,
  $$values (1::smallint, 11::bigint), (2::smallint, 39::bigint), (3::smallint, 6::bigint)$$,
  'roadmap seed preserves the three agreed iteration totals'
);
select is((select count(*)::integer from public.tasks where completion_mode = 'derived'), 6, 'stage one has six derived roadmap tasks');
select private.seed_roadmap_tasks((select id from public.boards limit 1));
select is((select count(*)::integer from public.tasks), 71, 'roadmap backfill is idempotent for an existing board');

select private.seed_audit_board(
  extensions.digest(convert_to('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'UTF8'), 'sha256')
);

select has_function('private', 'is_valid_board_token', array['text'], 'storage capability gate exists');
select is(
  private.is_valid_board_token('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M'),
  true,
  'storage capability gate accepts a known board token'
);
select is(
  private.is_valid_board_token('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
  false,
  'storage capability gate rejects an unknown token-shaped path'
);

set local role anon;

select is(current_user::text, 'anon', 'capability flow executes as anon');
select is(
  jsonb_array_length(public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'),
  71,
  'anon reads the board snapshot with a valid capability'
);
select throws_ok(
  $$select public.board_snapshot('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')$$,
  '22023',
  'invalid board token',
  'unknown tokens are rejected'
);
select throws_ok(
  $$select public.board_snapshot('short')$$,
  '22023',
  'invalid board token',
  'malformed tokens are rejected'
);
select throws_ok(
  $$select public.create_task(
    'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
    null,
    'Follow up',
    '',
    'P1',
    'audit',
    null,
    null
  )$$,
  '22023',
  'author must be 1 to 80 characters',
  'null authors are rejected by RPC validation'
);

select is(
  (
    select public.create_task(
    'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
    '  Reviewer  ',
    '  Follow up  ',
    'Details',
    'P2',
    'audit',
    null,
    null
    )->>'title'
  ),
  'Follow up',
  'anon creates a scoped task with a valid capability'
);
select is(
  jsonb_array_length(public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'),
  72,
  'anon-created task is visible in the capability snapshot'
);

select is(
  (
    select (task->>'completed')::boolean
    from jsonb_array_elements(
      public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'
    ) as task
    where task->>'completion_mode' = 'derived'
      and task->>'title' like 'P0: форма офиса%'
  ),
  false,
  'a linked roadmap task starts open while its audit tasks are open'
);
select is(
  (
    select jsonb_array_length(task->'audit_links')
    from jsonb_array_elements(
      public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'
    ) as task
    where task->>'completion_mode' = 'derived'
      and task->>'title' like 'P0: форма офиса%'
  ),
  2,
  'a linked roadmap task exposes only its two scoped audit references'
);
select throws_ok(
  $$select public.set_task_completed(
    'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
    'Reviewer',
    (
      select (task->>'id')::uuid
      from jsonb_array_elements(public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks') as task
      where task->>'completion_mode' = 'derived' and task->>'title' like 'P0: форма офиса%'
    ),
    true
  )$$,
  '22023',
  'derived roadmap task status is managed by audit links',
  'anon cannot manually complete a derived roadmap task'
);
select public.set_task_completed(
  'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
  'Reviewer',
  (
    select (task->>'id')::uuid
    from jsonb_array_elements(public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks') as task
    where task->>'track' = 'audit' and (task->>'position')::integer = 1
  ),
  true
);
select public.set_task_completed(
  'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
  'Reviewer',
  (
    select (task->>'id')::uuid
    from jsonb_array_elements(public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks') as task
    where task->>'track' = 'audit' and (task->>'position')::integer = 2
  ),
  true
);
select is(
  (
    select (task->>'completed')::boolean
    from jsonb_array_elements(
      public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'
    ) as task
    where task->>'completion_mode' = 'derived'
      and task->>'title' like 'P0: форма офиса%'
  ),
  true,
  'a linked roadmap task is completed when all its audit tasks are completed'
);
select is(
  (
    select public.create_task(
      'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
      'Reviewer',
      'Бриф для фотосессии',
      '',
      null,
      'roadmap',
      0::smallint,
      2::smallint
    )->>'track'
  ),
  'roadmap',
  'anon can create a manual roadmap task inside a stage'
);
select is(
  (
    select public.create_task(
      'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
      'Reviewer',
      'Задача этапа 2',
      '',
      null,
      'roadmap',
      2::smallint,
      3::smallint
    )->>'roadmap_iteration'
  ),
  '3',
  'stage two accepts its explicit iteration subgroup'
);
select throws_ok(
  $$select public.create_task(
    'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
    'Reviewer',
    'Некорректная задача',
    '',
    null,
    'roadmap',
    0::smallint,
    1::smallint
  )$$,
  '22023',
  'roadmap iteration is not valid for this stage',
  'roadmap task creation validates the stage iteration context'
);
select is(
  (
    select public.set_task_completed(
    'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
    'Reviewer',
    (
      select (task->>'id')::uuid
      from jsonb_array_elements(
        public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'
      ) as task
      where task->>'title' = 'Follow up'
    ),
    true
    )->>'completed'
  ),
  'true',
  'anon changes task completion with a valid capability'
);
select is(
  (
    select jsonb_array_length(task->'events')
    from jsonb_array_elements(
      public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'
    ) as task
    where task->>'title' = 'Follow up'
  ),
  2,
  'anon observes the server-written creation and completion events'
);

select is(
  (
    select public.add_task_comment(
    'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
    'Reviewer',
    (
      select (task->>'id')::uuid
      from jsonb_array_elements(
        public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'
      ) as task
      where task->>'title' = 'Follow up'
    ),
    'Looks good'
    )->>'body'
  ),
  'Looks good',
  'anon adds a task comment with a valid capability'
);
select is(
  (
    select jsonb_array_length(task->'comments')
    from jsonb_array_elements(
      public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'
    ) as task
    where task->>'title' = 'Follow up'
  ),
  1,
  'anon observes its persisted task comment in the snapshot'
);
select is(
  (
    select public.add_board_comment(
    'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
    'Reviewer',
    'General note'
    )->>'body'
  ),
  'General note',
  'anon adds a board comment with a valid capability'
);
select is(
  jsonb_array_length(public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'comments'),
  1,
  'anon observes its persisted board comment in the snapshot'
);
select is(
  (
    select public.add_board_message(
      'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
      'Reviewer',
      'Photo reply',
      (
        select (message->>'id')::uuid
        from jsonb_array_elements(
          public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'comments'
        ) as message
        where message->>'body' = 'General note'
      ),
      '[{"type":"image","name":"photo.jpg","mimeType":"image/jpeg","size":12,"path":"FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M/photo.jpg","url":"https://cdn.example.test/photo.jpg"}]'::jsonb
    )->>'parent_comment_id'
  ),
  (
    select message->>'id'
    from jsonb_array_elements(
      public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'comments'
    ) as message
    where message->>'body' = 'General note'
  ),
  'anon adds a board message with a reply and image metadata'
);
select is(
  (
    select jsonb_array_length(message->'attachments')
    from jsonb_array_elements(public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'comments') as message
    where message->>'body' = 'Photo reply'
  ),
  1,
  'snapshot preserves message attachment metadata'
);
select is(
  (
    select public.toggle_comment_reaction(
      'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
      'Reviewer',
      (
        select (message->>'id')::uuid
        from jsonb_array_elements(
          public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'comments'
        ) as message
        where message->>'body' = 'Photo reply'
      ),
      '👍'
    )->>'reacted'
  ),
  'true',
  'anon adds a reaction through the capability RPC'
);
select is(
  (
    select jsonb_array_length(message->'reactions')
    from jsonb_array_elements(public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'comments') as message
    where message->>'body' = 'Photo reply'
  ),
  1,
  'snapshot aggregates message reactions'
);
select is(
  (
    select public.add_task_message(
      'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
      'Reviewer',
      (
        select (task->>'id')::uuid
        from jsonb_array_elements(
          public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'
        ) as task
        where task->>'title' = 'Follow up'
      ),
      'Task voice',
      null,
      '[{"type":"audio","name":"voice.webm","mimeType":"audio/webm","size":24,"path":"FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M/voice.webm","url":"https://cdn.example.test/voice.webm"}]'::jsonb
    )->>'body'
  ),
  'Task voice',
  'anon adds an audio task message with a valid capability'
);
select is(
  jsonb_array_length(public.board_snapshot('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')->'tasks'),
  71,
  'a second capability sees only its own board tasks'
);
select throws_ok(
  $$select public.add_task_comment(
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    'Reviewer',
    (
      select (task->>'id')::uuid
      from jsonb_array_elements(
        public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'
      ) as task
      where task->>'title' = 'Follow up'
    ),
    'Cross-board comment'
  )$$,
  'P0002',
  'task not found',
  'task comment RPC rejects a task from another board'
);
select throws_ok(
  $$select * from public.boards$$,
  '42501',
  'permission denied for table boards',
  'anon direct SELECT is denied'
);
select throws_ok(
  $$insert into public.tasks default values$$,
  '42501',
  'permission denied for table tasks',
  'anon direct INSERT is denied'
);
select throws_ok(
  $$update public.tasks set completed = true$$,
  '42501',
  'permission denied for table tasks',
  'anon direct UPDATE is denied'
);
select throws_ok(
  $$delete from public.board_comments$$,
  '42501',
  'permission denied for table board_comments',
  'anon direct DELETE is denied'
);
select throws_ok(
  $$select * from public.task_audit_links$$,
  '42501',
  'permission denied for table task_audit_links',
  'anon direct SELECT of roadmap audit links is denied'
);

reset role;

select throws_ok(
  $$insert into public.task_comments (board_id, task_id, author, body)
    values (
      (select id from public.boards where token_hash = extensions.digest(convert_to('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'UTF8'), 'sha256')),
      (select id from public.tasks where title = 'Follow up'),
      'Reviewer',
      'Cross-board comment'
    )$$,
  '23503',
  null,
  'composite foreign key prevents cross-board task records'
);
select throws_ok(
  $$update public.task_comments set body = 'Changed'$$,
  '55000',
  'task_comments are immutable',
  'task comments cannot be edited'
);
select throws_ok(
  $$delete from public.board_comments$$,
  '55000',
  'board_comments are immutable',
  'board comments cannot be deleted'
);

select * from finish();
rollback;
