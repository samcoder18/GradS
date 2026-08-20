create or replace function private.normalize_roadmap_only(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.tasks
     set completion_mode = 'manual'
   where board_id = p_board_id
     and track = 'roadmap'
     and completion_mode = 'derived';

end;
$$;

revoke all on function private.normalize_roadmap_only(uuid) from public, anon, authenticated, service_role;

create or replace function private.validate_task_audit_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  roadmap_track text;
  audit_track text;
begin
  select tasks.track
    into roadmap_track
    from public.tasks
   where tasks.board_id = new.board_id
     and tasks.id = new.roadmap_task_id;

  select tasks.track
    into audit_track
    from public.tasks
   where tasks.board_id = new.board_id
     and tasks.id = new.audit_task_id;

  if roadmap_track <> 'roadmap' then
    raise exception using errcode = '22023', message = 'roadmap links require a roadmap task';
  end if;
  if audit_track <> 'audit' then
    raise exception using errcode = '22023', message = 'roadmap links must target audit tasks';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_task_audit_link() from public, anon, authenticated;

select private.normalize_roadmap_only(boards.id)
from public.boards;

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
      select jsonb_agg(task_json order by tasks.sort_stage, tasks.sort_iteration, tasks.sort_position)
      from (
        select
          tasks.roadmap_stage as sort_stage,
          tasks.roadmap_iteration as sort_iteration,
          tasks.position as sort_position,
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
          'completed', tasks.completed,
          'created_by', tasks.created_by,
          'created_at', tasks.created_at,
          'updated_at', tasks.updated_at,
          'audit_links', '[]'::jsonb,
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
                'parent_comment_id', task_comments.parent_comment_id,
                'author', task_comments.author,
                'body', task_comments.body,
                'attachments', task_comments.attachments,
                'reactions', private.comment_reactions(selected_board_id, null, task_comments.id),
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
          and tasks.track = 'roadmap'
      ) as tasks
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', board_comments.id,
          'parent_comment_id', board_comments.parent_comment_id,
          'author', board_comments.author,
          'body', board_comments.body,
          'attachments', board_comments.attachments,
          'reactions', private.comment_reactions(selected_board_id, board_comments.id, null),
          'created_at', board_comments.created_at
        ) order by board_comments.created_at, board_comments.id
      )
      from public.board_comments
      where board_comments.board_id = selected_board_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.board_snapshot(text) from public, anon, authenticated;
grant execute on function public.board_snapshot(text) to anon, authenticated;

create or replace function public.create_task(
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
  if normalized_track <> 'roadmap' then
    raise exception using errcode = '22023', message = 'only roadmap tasks can be created';
  end if;
  if create_task.priority is not null then
    raise exception using errcode = '22023', message = 'roadmap tasks do not have a priority';
  end if;
  if create_task.roadmap_stage is null or create_task.roadmap_stage not between 0 and 8 then
    raise exception using errcode = '22023', message = 'roadmap stage must be between 0 and 8';
  end if;
  if not private.roadmap_iteration_is_valid(create_task.roadmap_stage, create_task.roadmap_iteration) then
    raise exception using errcode = '22023', message = 'roadmap iteration is not valid for this stage';
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
    null,
    'roadmap',
    create_task.roadmap_stage,
    create_task.roadmap_iteration,
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

revoke all on function public.create_task(text, text, text, text, text, text, smallint, smallint)
  from public, anon, authenticated;
grant execute on function public.create_task(text, text, text, text, text, text, smallint, smallint)
  to anon, authenticated;

create or replace function public.set_task_completed(token text, author text, task_id uuid, completed boolean)
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
  existing_track text;
  changed_at timestamptz;
begin
  if normalized_author is null or char_length(normalized_author) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'author must be 1 to 80 characters';
  end if;
  if set_task_completed.task_id is null or set_task_completed.completed is null then
    raise exception using errcode = '22023', message = 'task_id and completed are required';
  end if;

  select tasks.completed, tasks.completion_mode, tasks.track
    into existing_completed, existing_completion_mode, existing_track
    from public.tasks
   where tasks.board_id = selected_board_id
     and tasks.id = set_task_completed.task_id
   for update;

  if not found or existing_track <> 'roadmap' then
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

revoke all on function public.set_task_completed(text, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_task_completed(text, text, uuid, boolean)
  to anon, authenticated;
