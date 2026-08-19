create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  created_at timestamptz not null default clock_timestamp(),
  constraint boards_token_hash_sha256 check (octet_length(token_hash) = 32)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  position integer not null,
  title text not null,
  description text not null default '',
  priority text not null,
  completed boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint tasks_board_position_key unique (board_id, position),
  constraint tasks_board_id_id_key unique (board_id, id),
  constraint tasks_position_positive check (position > 0),
  constraint tasks_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint tasks_description_length check (char_length(description) <= 4000),
  constraint tasks_priority_value check (priority in ('P0', 'P1', 'P2', 'P3')),
  constraint tasks_created_by_length check (char_length(btrim(created_by)) between 1 and 80)
);

create table public.task_events (
  id bigint generated always as identity primary key,
  board_id uuid not null,
  task_id uuid not null,
  event_type text not null,
  actor text not null,
  from_completed boolean,
  to_completed boolean,
  created_at timestamptz not null default clock_timestamp(),
  constraint task_events_task_fkey foreign key (board_id, task_id)
    references public.tasks(board_id, id) on delete cascade,
  constraint task_events_actor_length check (char_length(btrim(actor)) between 1 and 80),
  constraint task_events_status_shape check (
    (event_type = 'created' and from_completed is null and to_completed = false)
    or
    (event_type = 'completion_changed'
      and from_completed is not null
      and to_completed is not null
      and from_completed <> to_completed)
  )
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  task_id uuid not null,
  author text not null,
  body text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint task_comments_task_fkey foreign key (board_id, task_id)
    references public.tasks(board_id, id) on delete cascade,
  constraint task_comments_author_length check (char_length(btrim(author)) between 1 and 80),
  constraint task_comments_body_length check (char_length(btrim(body)) between 1 and 4000)
);

create table public.board_comments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  author text not null,
  body text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint board_comments_author_length check (char_length(btrim(author)) between 1 and 80),
  constraint board_comments_body_length check (char_length(btrim(body)) between 1 and 4000)
);

create index task_events_board_task_created_idx on public.task_events(board_id, task_id, created_at, id);
create index task_comments_board_task_created_idx on public.task_comments(board_id, task_id, created_at, id);
create index board_comments_board_created_idx on public.board_comments(board_id, created_at, id);

alter table public.boards enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.task_comments enable row level security;
alter table public.board_comments enable row level security;

revoke all on public.boards from public, anon, authenticated;
revoke all on public.tasks from public, anon, authenticated;
revoke all on public.task_events from public, anon, authenticated;
revoke all on public.task_comments from public, anon, authenticated;
revoke all on public.board_comments from public, anon, authenticated;
revoke all on sequence public.task_events_id_seq from public, anon, authenticated;

grant all on public.boards to service_role;
grant all on public.tasks to service_role;
grant all on public.task_events to service_role;
grant all on public.task_comments to service_role;
grant all on public.board_comments to service_role;
grant all on sequence public.task_events_id_seq to service_role;

create or replace function private.reject_immutable_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%s are immutable', tg_table_name);
end;
$$;

create trigger task_events_immutable
before update or delete on public.task_events
for each row execute function private.reject_immutable_change();

create trigger task_comments_immutable
before update or delete on public.task_comments
for each row execute function private.reject_immutable_change();

create trigger board_comments_immutable
before update or delete on public.board_comments
for each row execute function private.reject_immutable_change();

create or replace function private.board_for_token(token text)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  found_board_id uuid;
begin
  if token is null or token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = '22023', message = 'invalid board token';
  end if;

  select boards.id
    into found_board_id
    from public.boards
   where boards.token_hash = extensions.digest(convert_to(token, 'UTF8'), 'sha256');

  if found_board_id is null then
    raise exception using errcode = '22023', message = 'invalid board token';
  end if;

  return found_board_id;
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
      select jsonb_build_object(
        'id', boards.id,
        'created_at', boards.created_at
      )
      from public.boards
      where boards.id = selected_board_id
    ),
    'tasks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', tasks.id,
          'position', tasks.position,
          'title', tasks.title,
          'description', tasks.description,
          'priority', tasks.priority,
          'completed', tasks.completed,
          'created_by', tasks.created_by,
          'created_at', tasks.created_at,
          'updated_at', tasks.updated_at,
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
        ) order by tasks.position
      )
      from public.tasks
      where tasks.board_id = selected_board_id
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

create or replace function public.create_task(
  token text,
  author text,
  title text,
  description text,
  priority text
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
  normalized_description text := coalesce(create_task.description, '');
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
  if create_task.priority is null or create_task.priority not in ('P0', 'P1', 'P2', 'P3') then
    raise exception using errcode = '22023', message = 'priority must be P0, P1, P2, or P3';
  end if;

  perform 1 from public.boards where boards.id = selected_board_id for update;
  select coalesce(max(tasks.position), 0) + 1
    into new_position
    from public.tasks
   where tasks.board_id = selected_board_id;

  insert into public.tasks (
    board_id, position, title, description, priority, completed, created_by
  ) values (
    selected_board_id,
    new_position,
    normalized_title,
    normalized_description,
    create_task.priority,
    false,
    normalized_author
  ) returning * into new_task;

  insert into public.task_events (
    board_id, task_id, event_type, actor, from_completed, to_completed
  ) values (
    selected_board_id, new_task.id, 'created', normalized_author, null, false
  );

  return jsonb_build_object(
    'id', new_task.id,
    'position', new_task.position,
    'title', new_task.title,
    'description', new_task.description,
    'priority', new_task.priority,
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
  changed_at timestamptz;
begin
  if normalized_author is null or char_length(normalized_author) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'author must be 1 to 80 characters';
  end if;
  if set_task_completed.task_id is null or set_task_completed.completed is null then
    raise exception using errcode = '22023', message = 'task_id and completed are required';
  end if;

  select tasks.completed
    into existing_completed
    from public.tasks
   where tasks.board_id = selected_board_id
     and tasks.id = set_task_completed.task_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
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
    select jsonb_build_object(
      'id', tasks.id,
      'completed', tasks.completed,
      'updated_at', tasks.updated_at
    )
    from public.tasks
    where tasks.board_id = selected_board_id
      and tasks.id = set_task_completed.task_id
  );
end;
$$;

create or replace function public.add_task_comment(
  token text,
  author text,
  task_id uuid,
  body text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  selected_board_id uuid := private.board_for_token(add_task_comment.token);
  normalized_author text := btrim(add_task_comment.author);
  normalized_body text := btrim(add_task_comment.body);
  new_comment public.task_comments%rowtype;
begin
  if normalized_author is null or char_length(normalized_author) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'author must be 1 to 80 characters';
  end if;
  if normalized_body is null or char_length(normalized_body) not between 1 and 4000 then
    raise exception using errcode = '22023', message = 'body must be 1 to 4000 characters';
  end if;
  if add_task_comment.task_id is null then
    raise exception using errcode = '22023', message = 'task_id is required';
  end if;

  if not exists (
    select 1 from public.tasks
    where tasks.board_id = selected_board_id
      and tasks.id = add_task_comment.task_id
  ) then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_comments (board_id, task_id, author, body)
  values (selected_board_id, add_task_comment.task_id, normalized_author, normalized_body)
  returning * into new_comment;

  return jsonb_build_object(
    'id', new_comment.id,
    'task_id', new_comment.task_id,
    'author', new_comment.author,
    'body', new_comment.body,
    'created_at', new_comment.created_at
  );
end;
$$;

create or replace function public.add_board_comment(
  token text,
  author text,
  body text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  selected_board_id uuid := private.board_for_token(add_board_comment.token);
  normalized_author text := btrim(add_board_comment.author);
  normalized_body text := btrim(add_board_comment.body);
  new_comment public.board_comments%rowtype;
begin
  if normalized_author is null or char_length(normalized_author) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'author must be 1 to 80 characters';
  end if;
  if normalized_body is null or char_length(normalized_body) not between 1 and 4000 then
    raise exception using errcode = '22023', message = 'body must be 1 to 4000 characters';
  end if;

  insert into public.board_comments (board_id, author, body)
  values (selected_board_id, normalized_author, normalized_body)
  returning * into new_comment;

  return jsonb_build_object(
    'id', new_comment.id,
    'author', new_comment.author,
    'body', new_comment.body,
    'created_at', new_comment.created_at
  );
end;
$$;

revoke all on function private.reject_immutable_change() from public, anon, authenticated;
revoke all on function private.board_for_token(text) from public, anon, authenticated;

revoke all on function public.board_snapshot(text) from public, anon, authenticated;
revoke all on function public.create_task(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.set_task_completed(text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.add_task_comment(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.add_board_comment(text, text, text) from public, anon, authenticated;

grant execute on function public.board_snapshot(text) to anon, authenticated;
grant execute on function public.create_task(text, text, text, text, text) to anon, authenticated;
grant execute on function public.set_task_completed(text, text, uuid, boolean) to anon, authenticated;
grant execute on function public.add_task_comment(text, text, uuid, text) to anon, authenticated;
grant execute on function public.add_board_comment(text, text, text) to anon, authenticated;
