begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

select has_table('public', 'boards', 'boards table exists');
select has_table('public', 'tasks', 'tasks table exists');
select has_table('public', 'task_events', 'task events table exists');
select has_table('public', 'task_comments', 'task comments table exists');
select has_table('public', 'board_comments', 'board comments table exists');

select ok((select relrowsecurity from pg_class where oid = 'public.boards'::regclass), 'boards uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), 'tasks uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.task_events'::regclass), 'task events use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.task_comments'::regclass), 'task comments use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.board_comments'::regclass), 'board comments use RLS');

select ok(not has_table_privilege('anon', 'public.boards', 'SELECT'), 'anon cannot select boards');
select ok(not has_table_privilege('anon', 'public.tasks', 'INSERT'), 'anon cannot insert tasks directly');
select ok(not has_table_privilege('anon', 'public.task_comments', 'UPDATE'), 'anon cannot edit comments directly');
select ok(not has_table_privilege('authenticated', 'public.board_comments', 'DELETE'), 'authenticated cannot delete comments directly');

select has_function('public', 'board_snapshot', array['text'], 'board_snapshot RPC exists');
select has_function('public', 'create_task', array['text', 'text', 'text', 'text', 'text'], 'create_task RPC exists');
select has_function('public', 'set_task_completed', array['text', 'text', 'uuid', 'boolean'], 'set_task_completed RPC exists');
select has_function('public', 'add_task_comment', array['text', 'text', 'uuid', 'text'], 'add_task_comment RPC exists');
select has_function('public', 'add_board_comment', array['text', 'text', 'text'], 'add_board_comment RPC exists');

select ok(
  (select prosecdef from pg_proc where oid = 'public.board_snapshot(text)'::regprocedure),
  'board_snapshot is security definer'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.create_task(text,text,text,text,text)'::regprocedure),
  'create_task is security definer'
);
select is(
  (
    select count(*)::integer
    from pg_proc
    where oid in (
      'public.board_snapshot(text)'::regprocedure,
      'public.create_task(text,text,text,text,text)'::regprocedure,
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
select ok(has_function_privilege('anon', 'public.create_task(text,text,text,text,text)', 'EXECUTE'), 'anon can execute create_task');
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
select is((select count(*)::integer from public.tasks), 15, 'seed creates all 15 roadmap tasks');
select results_eq(
  $$select priority, count(*)::bigint from public.tasks group by priority order by priority$$,
  $$values ('P0'::text, 2::bigint), ('P1'::text, 5::bigint), ('P2'::text, 5::bigint), ('P3'::text, 3::bigint)$$,
  'seed preserves P0-P3 grouping'
);
select results_eq(
  $$select position, title, priority from public.tasks order by position$$,
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
select is((select count(*)::integer from public.task_events where event_type = 'created'), 15, 'seed records creation events');

select is(
  jsonb_array_length(public.board_snapshot('FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M')->'tasks'),
  15,
  'valid token reads the board snapshot'
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
    'P1'
  )$$,
  '22023',
  'author must be 1 to 80 characters',
  'null authors are rejected by RPC validation'
);

select lives_ok(
  $$select public.create_task(
    'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
    '  Reviewer  ',
    '  Follow up  ',
    'Details',
    'P2'
  )$$,
  'valid token can create a scoped task'
);
select is((select count(*)::integer from public.tasks), 16, 'new task is persisted');
select is((select count(*)::integer from public.task_events where event_type = 'created'), 16, 'new task writes a creation event');

select lives_ok(
  $$select public.set_task_completed(
    'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
    'Reviewer',
    (select id from public.tasks where title = 'Follow up'),
    true
  )$$,
  'task completion can be changed through the RPC'
);
select is(
  (select count(*)::integer from public.task_events where event_type = 'completion_changed'),
  1,
  'completion change writes one status event'
);

select lives_ok(
  $$select public.add_task_comment(
    'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
    'Reviewer',
    (select id from public.tasks where title = 'Follow up'),
    'Looks good'
  )$$,
  'task comments can be added through the RPC'
);
select lives_ok(
  $$select public.add_board_comment(
    'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M',
    'Reviewer',
    'General note'
  )$$,
  'board comments can be added through the RPC'
);

select private.seed_audit_board(
  extensions.digest(convert_to('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'UTF8'), 'sha256')
);
select is(
  jsonb_array_length(public.board_snapshot('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')->'tasks'),
  15,
  'a second capability sees only its own board tasks'
);
select throws_ok(
  $$select public.add_task_comment(
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    'Reviewer',
    (select id from public.tasks where title = 'Follow up'),
    'Cross-board comment'
  )$$,
  'P0002',
  'task not found',
  'task comment RPC rejects a task from another board'
);
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
