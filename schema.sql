-- Home CRM: схема БД. Выполните целиком в Supabase → SQL Editor.
create extension if not exists pgcrypto;

-- ============ Таблицы ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login text not null unique,
  display_name text not null,
  role text not null default 'member' check (role in ('admin','member')),
  status text not null default 'pending' check (status in ('pending','approved','blocked')),
  is_protected boolean not null default false,       -- защищённые админы (Степан, Дмитрий)
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null
);
insert into public.settings(key,value) values ('auto_approve','false'::jsonb) on conflict do nothing;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text, email text, company text,
  tags text[] not null default '{}',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  client text,
  contact_id uuid references public.contacts(id) on delete set null,
  color text not null default '#6d7cff',
  start_date date, end_date date,
  status text not null default 'active' check (status in ('active','paused','done')),
  archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  importance int not null default 3 check (importance between 1 and 5),
  due_at timestamptz,
  assignee_id uuid references public.profiles(id) on delete set null,
  position double precision not null default 1000,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  started_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  position double precision not null default 1000,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  project_id uuid references public.projects(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  attendees uuid[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_interactions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  kind text not null check (kind in ('call','meeting','message')),
  note text,
  happened_at timestamptz not null default now(),
  author_id uuid references public.profiles(id) on delete set null
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text,
  entity_type text,
  entity_id uuid,
  message text not null,
  created_at timestamptz not null default now()
);

-- ============ Индексы ============
create index if not exists idx_tasks_project on public.tasks(project_id);
create index if not exists idx_tasks_assignee on public.tasks(assignee_id);
create index if not exists idx_tasks_due on public.tasks(due_at);
create index if not exists idx_tasks_status on public.tasks(status);
create index if not exists idx_subtasks_task on public.subtasks(task_id);
create index if not exists idx_comments_task on public.comments(task_id);
create index if not exists idx_events_start on public.events(starts_at);
create index if not exists idx_events_project on public.events(project_id);
create index if not exists idx_interactions_contact on public.contact_interactions(contact_id);
create index if not exists idx_activity_created on public.activity_log(created_at desc);
create index if not exists idx_activity_entity on public.activity_log(entity_id);
create index if not exists idx_projects_contact on public.projects(contact_id);

-- ============ Вспомогательные функции ============
create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'approved');
$$;

-- ============ Триггеры ============
-- updated_at
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$ declare t text; begin
  foreach t in array array['projects','contacts','events','comments'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- tasks: updated_at, updated_by, started_*/completed_* (авторитетная логика на стороне БД)
create or replace function public.tasks_before_write() returns trigger language plpgsql as $$
declare uid uuid := auth.uid();
begin
  new.updated_at = now();
  if uid is not null then new.updated_by = uid; end if;
  if tg_op = 'INSERT' then
    if new.status = 'in_progress' then new.started_by = coalesce(uid,new.created_by); new.started_at = now();
    elsif new.status = 'done' then new.completed_by = coalesce(uid,new.created_by); new.completed_at = now(); end if;
  elsif new.status is distinct from old.status then
    if new.status = 'in_progress' then
      new.started_by = uid; new.started_at = now(); new.completed_by = null; new.completed_at = null;
    elsif new.status = 'done' then
      if new.started_at is null then new.started_by = uid; new.started_at = now(); end if;
      new.completed_by = uid; new.completed_at = now();
    else -- возврат в «К выполнению»: сброс
      new.started_by = null; new.started_at = null; new.completed_by = null; new.completed_at = null;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_tasks_write on public.tasks;
create trigger trg_tasks_write before insert or update on public.tasks for each row execute function public.tasks_before_write();

-- Защита admin-аккаунтов и запрет самоповышения
create or replace function public.protect_profiles() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_protected then raise exception 'Защищённого администратора нельзя удалить'; end if;
    return old;
  end if;
  -- защищённые админы: роль, статус и признак защиты неизменяемы
  if old.is_protected and (new.role <> 'admin' or new.status <> 'approved' or new.is_protected = false) then
    raise exception 'Защищённого администратора нельзя понизить или заблокировать';
  end if;
  -- обычный пользователь не может менять role/status/is_protected (SQL Editor и service_role: auth.uid() is null — разрешено)
  if auth.uid() is not null and not public.is_admin() then
    if new.role <> old.role or new.status <> old.status or new.is_protected <> old.is_protected or new.login <> old.login then
      raise exception 'Недостаточно прав для изменения роли, статуса или логина';
    end if;
  end if;
  -- admin не может менять is_protected через клиент
  if auth.uid() is not null and new.is_protected <> old.is_protected then
    raise exception 'Признак защиты меняется только через SQL';
  end if;
  return new;
end; $$;
drop trigger if exists trg_protect_profiles on public.profiles;
create trigger trg_protect_profiles before update or delete on public.profiles for each row execute function public.protect_profiles();

-- Автосоздание профиля при регистрации: всегда member; pending (или approved при включённом автоодобрении)
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare lg text; nm text; auto boolean;
begin
  lg = lower(split_part(new.email,'@',1));
  nm = coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''), lg);
  select coalesce((value)::text::boolean,false) into auto from public.settings where key='auto_approve';
  insert into public.profiles(id,login,display_name,role,status)
  values (new.id, lg, left(nm,40), 'member', case when coalesce(auto,false) then 'approved' else 'pending' end);
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ============ RLS ============
do $$ declare t text; begin
  foreach t in array array['profiles','settings','contacts','projects','tasks','subtasks','comments','events','contact_interactions','activity_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- profiles: свой профиль виден всегда (чтобы pending видел свой статус), остальные — только approved
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_approved());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
-- insert/delete для клиентов нет: профиль создаёт триггер, удаление — Edge Function (service_role)

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated using (public.is_approved());
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Универсальные политики для таблиц с created_by
do $$ declare t text; begin
  foreach t in array array['contacts','projects','events'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_approved())', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_approved() and created_by = auth.uid())', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_approved() and (created_by = auth.uid() or public.is_admin())) with check (public.is_approved() and (created_by = auth.uid() or public.is_admin()))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_approved() and (created_by = auth.uid() or public.is_admin()))', t);
  end loop;
end $$;

-- tasks: редактирует автор, исполнитель или admin
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated using (public.is_approved());
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated with check (public.is_approved() and created_by = auth.uid());
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_approved() and (created_by = auth.uid() or assignee_id = auth.uid() or public.is_admin()))
  with check (public.is_approved());
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated using (public.is_approved() and (created_by = auth.uid() or public.is_admin()));

-- subtasks: права наследуются от задачи
drop policy if exists subtasks_select on public.subtasks;
create policy subtasks_select on public.subtasks for select to authenticated using (public.is_approved());
drop policy if exists subtasks_write on public.subtasks;
create policy subtasks_write on public.subtasks for all to authenticated
  using (public.is_approved() and exists (select 1 from public.tasks t where t.id = task_id and (t.created_by = auth.uid() or t.assignee_id = auth.uid() or public.is_admin())))
  with check (public.is_approved() and exists (select 1 from public.tasks t where t.id = task_id and (t.created_by = auth.uid() or t.assignee_id = auth.uid() or public.is_admin())));

-- comments: комментировать может любой approved, править/удалять — автор или admin
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated using (public.is_approved());
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated with check (public.is_approved() and author_id = auth.uid());
drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update to authenticated using (public.is_approved() and (author_id = auth.uid() or public.is_admin())) with check (public.is_approved());
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated using (public.is_approved() and (author_id = auth.uid() or public.is_admin()));

-- contact_interactions
drop policy if exists ci_select on public.contact_interactions;
create policy ci_select on public.contact_interactions for select to authenticated using (public.is_approved());
drop policy if exists ci_insert on public.contact_interactions;
create policy ci_insert on public.contact_interactions for insert to authenticated with check (public.is_approved() and author_id = auth.uid());
drop policy if exists ci_delete on public.contact_interactions;
create policy ci_delete on public.contact_interactions for delete to authenticated using (public.is_approved() and (author_id = auth.uid() or public.is_admin()));

-- activity_log: читать approved; писать только от своего имени; не менять
drop policy if exists al_select on public.activity_log;
create policy al_select on public.activity_log for select to authenticated using (public.is_approved());
drop policy if exists al_insert on public.activity_log;
create policy al_insert on public.activity_log for insert to authenticated with check (public.is_approved() and actor_id = auth.uid());

-- ============ Права ============
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- ============ Realtime ============
do $$ declare t text; begin
  foreach t in array array['profiles','projects','tasks','subtasks','comments','events','contacts','contact_interactions','activity_log','settings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
