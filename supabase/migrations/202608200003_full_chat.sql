alter table public.task_comments
  add column parent_comment_id uuid,
  add column attachments jsonb not null default '[]'::jsonb,
  add constraint task_comments_attachments_shape check (
    jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5
  );

alter table public.board_comments
  add column parent_comment_id uuid,
  add column attachments jsonb not null default '[]'::jsonb,
  add constraint board_comments_attachments_shape check (
    jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5
  );

alter table public.task_comments
  add constraint task_comments_board_id_id_key unique (board_id, id);

alter table public.board_comments
  add constraint board_comments_board_id_id_key unique (board_id, id);

alter table public.task_comments
  add constraint task_comments_parent_fkey
  foreign key (board_id, parent_comment_id)
  references public.task_comments (board_id, id)
  on delete restrict;

alter table public.board_comments
  add constraint board_comments_parent_fkey
  foreign key (board_id, parent_comment_id)
  references public.board_comments (board_id, id)
  on delete restrict;

create index task_comments_parent_idx on public.task_comments(board_id, parent_comment_id);
create index board_comments_parent_idx on public.board_comments(board_id, parent_comment_id);

create table public.comment_reactions (
  id bigint generated always as identity primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  board_comment_id uuid,
  task_comment_id uuid,
  author text not null,
  emoji text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint comment_reactions_board_comment_fkey
    foreign key (board_id, board_comment_id)
    references public.board_comments (board_id, id)
    on delete cascade,
  constraint comment_reactions_task_comment_fkey
    foreign key (board_id, task_comment_id)
    references public.task_comments (board_id, id)
    on delete cascade,
  constraint comment_reactions_one_target check (
    (board_comment_id is not null and task_comment_id is null)
    or (board_comment_id is null and task_comment_id is not null)
  ),
  constraint comment_reactions_author_length check (char_length(btrim(author)) between 1 and 80),
  constraint comment_reactions_emoji_value check (emoji in ('👍', '❤️', '🎉', '👀'))
);

create unique index comment_reactions_board_unique_idx
  on public.comment_reactions(board_comment_id, author, emoji)
  where board_comment_id is not null;
create unique index comment_reactions_task_unique_idx
  on public.comment_reactions(task_comment_id, author, emoji)
  where task_comment_id is not null;

alter table public.comment_reactions enable row level security;
revoke all on public.comment_reactions from public, anon, authenticated;
revoke all on sequence public.comment_reactions_id_seq from public, anon, authenticated;
grant all on public.comment_reactions to service_role;
grant all on sequence public.comment_reactions_id_seq to service_role;

insert into storage.buckets (id, name, public)
values ('audit-media', 'audit-media', true)
on conflict (id) do update set public = true;

create or replace function private.is_valid_board_token(candidate text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select candidate ~ '^[A-Za-z0-9_-]{43}$'
    and exists (
      select 1
      from public.boards
      where token_hash = extensions.digest(convert_to(candidate, 'UTF8'), 'sha256')
    );
$$;

drop policy if exists audit_media_public_read on storage.objects;
drop policy if exists audit_media_capability_upload on storage.objects;

create policy audit_media_public_read
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'audit-media'
  and private.is_valid_board_token((storage.foldername(name))[1])
);

create policy audit_media_capability_upload
on storage.objects for insert
to anon, authenticated
with check (
  bucket_id = 'audit-media'
  and private.is_valid_board_token((storage.foldername(name))[1])
);

create or replace function private.validate_chat_message(
  p_author text,
  p_body text,
  p_attachments jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_author is null or char_length(btrim(p_author)) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'author must be 1 to 80 characters';
  end if;
  if char_length(coalesce(p_body, '')) > 4000 then
    raise exception using errcode = '22023', message = 'body must be at most 4000 characters';
  end if;
  if btrim(coalesce(p_body, '')) = ''
     and jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'message must include text or an attachment';
  end if;
  if p_attachments is null then
    return;
  end if;
  if jsonb_typeof(p_attachments) <> 'array' or jsonb_array_length(p_attachments) > 5 then
    raise exception using errcode = '22023', message = 'attachments must contain at most 5 items';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_attachments) as attachment
    where attachment->>'type' not in ('image', 'audio')
      or char_length(coalesce(attachment->>'name', '')) not between 1 and 160
      or char_length(coalesce(attachment->>'mimeType', '')) not between 1 and 120
      or not (coalesce(attachment->>'size', '') ~ '^[0-9]+$')
      or (attachment->>'size')::numeric > 8388608
      or char_length(coalesce(attachment->>'path', '')) not between 1 and 500
      or char_length(coalesce(attachment->>'url', '')) not between 1 and 2000
  ) then
    raise exception using errcode = '22023', message = 'attachments contain invalid metadata';
  end if;
end;
$$;

create or replace function private.comment_reactions(
  p_board_id uuid,
  p_board_comment_id uuid,
  p_task_comment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'emoji', grouped.emoji,
        'count', grouped.total,
        'authors', grouped.authors
      ) order by grouped.emoji
    )
    from (
      select emoji, count(*)::integer as total, jsonb_agg(author order by author) as authors
      from public.comment_reactions
      where board_id = p_board_id
        and (
          (p_board_comment_id is not null and board_comment_id = p_board_comment_id)
          or (p_task_comment_id is not null and task_comment_id = p_task_comment_id)
        )
      group by emoji
    ) as grouped
  ), '[]'::jsonb);
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
      ) as task_sort
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

create or replace function public.add_board_message(
  token text,
  author text,
  body text,
  parent_comment_id uuid,
  attachments jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  selected_board_id uuid := private.board_for_token(add_board_message.token);
  normalized_author text := btrim(add_board_message.author);
  normalized_body text := btrim(coalesce(add_board_message.body, ''));
  normalized_attachments jsonb := coalesce(add_board_message.attachments, '[]'::jsonb);
  new_comment public.board_comments%rowtype;
begin
  perform private.validate_chat_message(normalized_author, normalized_body, normalized_attachments);
  if add_board_message.parent_comment_id is not null and not exists (
    select 1 from public.board_comments
    where board_id = selected_board_id and id = add_board_message.parent_comment_id
  ) then
    raise exception using errcode = 'P0002', message = 'parent message not found';
  end if;

  insert into public.board_comments (board_id, parent_comment_id, author, body, attachments)
  values (
    selected_board_id,
    add_board_message.parent_comment_id,
    normalized_author,
    normalized_body,
    normalized_attachments
  )
  returning * into new_comment;

  return jsonb_build_object(
    'id', new_comment.id,
    'parent_comment_id', new_comment.parent_comment_id,
    'author', new_comment.author,
    'body', new_comment.body,
    'attachments', new_comment.attachments,
    'reactions', '[]'::jsonb,
    'created_at', new_comment.created_at
  );
end;
$$;

create or replace function public.add_task_message(
  token text,
  author text,
  task_id uuid,
  body text,
  parent_comment_id uuid,
  attachments jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  selected_board_id uuid := private.board_for_token(add_task_message.token);
  normalized_author text := btrim(add_task_message.author);
  normalized_body text := btrim(coalesce(add_task_message.body, ''));
  normalized_attachments jsonb := coalesce(add_task_message.attachments, '[]'::jsonb);
  new_comment public.task_comments%rowtype;
begin
  perform private.validate_chat_message(normalized_author, normalized_body, normalized_attachments);
  if not exists (
    select 1 from public.tasks where board_id = selected_board_id and id = add_task_message.task_id
  ) then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if add_task_message.parent_comment_id is not null and not exists (
    select 1 from public.task_comments as comments
    where comments.board_id = selected_board_id
      and comments.task_id = add_task_message.task_id
      and comments.id = add_task_message.parent_comment_id
  ) then
    raise exception using errcode = 'P0002', message = 'parent message not found';
  end if;

  insert into public.task_comments (board_id, task_id, parent_comment_id, author, body, attachments)
  values (
    selected_board_id,
    add_task_message.task_id,
    add_task_message.parent_comment_id,
    normalized_author,
    normalized_body,
    normalized_attachments
  )
  returning * into new_comment;

  return jsonb_build_object(
    'id', new_comment.id,
    'task_id', new_comment.task_id,
    'parent_comment_id', new_comment.parent_comment_id,
    'author', new_comment.author,
    'body', new_comment.body,
    'attachments', new_comment.attachments,
    'reactions', '[]'::jsonb,
    'created_at', new_comment.created_at
  );
end;
$$;

create or replace function public.toggle_comment_reaction(
  token text,
  author text,
  comment_id uuid,
  emoji text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  selected_board_id uuid := private.board_for_token(toggle_comment_reaction.token);
  normalized_author text := btrim(toggle_comment_reaction.author);
  normalized_emoji text := btrim(toggle_comment_reaction.emoji);
  removed boolean := false;
begin
  if normalized_author is null or char_length(normalized_author) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'author must be 1 to 80 characters';
  end if;
  if normalized_emoji not in ('👍', '❤️', '🎉', '👀') then
    raise exception using errcode = '22023', message = 'unsupported reaction';
  end if;
  if exists (
    select 1 from public.task_comments
    where board_id = selected_board_id and id = toggle_comment_reaction.comment_id
  ) then
    delete from public.comment_reactions as reactions
    where reactions.board_id = selected_board_id
      and reactions.task_comment_id = toggle_comment_reaction.comment_id
      and reactions.author = normalized_author
      and reactions.emoji = normalized_emoji;
    removed := found;
    if not removed then
      insert into public.comment_reactions (board_id, task_comment_id, author, emoji)
      values (selected_board_id, toggle_comment_reaction.comment_id, normalized_author, normalized_emoji);
    end if;
  elsif exists (
    select 1 from public.board_comments
    where board_id = selected_board_id and id = toggle_comment_reaction.comment_id
  ) then
    delete from public.comment_reactions as reactions
    where reactions.board_id = selected_board_id
      and reactions.board_comment_id = toggle_comment_reaction.comment_id
      and reactions.author = normalized_author
      and reactions.emoji = normalized_emoji;
    removed := found;
    if not removed then
      insert into public.comment_reactions (board_id, board_comment_id, author, emoji)
      values (selected_board_id, toggle_comment_reaction.comment_id, normalized_author, normalized_emoji);
    end if;
  else
    raise exception using errcode = 'P0002', message = 'message not found';
  end if;

  return jsonb_build_object(
    'comment_id', toggle_comment_reaction.comment_id,
    'emoji', normalized_emoji,
    'reacted', not removed
  );
end;
$$;

revoke all on function private.validate_chat_message(text, text, jsonb) from public, anon, authenticated;
revoke all on function private.comment_reactions(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.is_valid_board_token(text) from public, anon, authenticated;
revoke all on function public.add_board_message(text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.add_task_message(text, text, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.toggle_comment_reaction(text, text, uuid, text) from public, anon, authenticated;

grant execute on function public.add_board_message(text, text, text, uuid, jsonb) to anon, authenticated;
grant execute on function public.add_task_message(text, text, uuid, text, uuid, jsonb) to anon, authenticated;
grant execute on function public.toggle_comment_reaction(text, text, uuid, text) to anon, authenticated;
grant execute on function private.is_valid_board_token(text) to anon, authenticated;
