-- Craftora's first schema migration.
-- Run against a dedicated Craftora Supabase project, not an unrelated project.
create extension if not exists pgcrypto;

create type public.craftora_project_type as enum
  ('mod', 'modpack', 'plugin', 'shader', 'resourcepack', 'datapack');
create type public.craftora_project_status as enum
  ('pending', 'published', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  bio text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_length check (username is null or char_length(username) between 3 and 24)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  slug text not null unique,
  summary text not null,
  description text not null default '',
  project_type public.craftora_project_type not null,
  status public.craftora_project_status not null default 'pending',
  icon_url text,
  source_url text,
  license text,
  game_versions text[] not null default '{}',
  loaders text[] not null default '{}',
  downloads bigint not null default 0 check (downloads >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_title_length check (char_length(title) between 2 and 80),
  constraint project_summary_length check (char_length(summary) between 5 and 180),
  constraint project_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint project_source_url_https check (source_url is null or source_url ~ '^https://')
);

create index projects_published_created_idx on public.projects (created_at desc) where status = 'published';
create index projects_published_type_idx on public.projects (project_type, created_at desc) where status = 'published';
create index projects_owner_idx on public.projects (owner_id, created_at desc);

create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number text not null,
  changelog text not null default '',
  game_versions text[] not null default '{}',
  loaders text[] not null default '{}',
  file_path text,
  file_name text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  file_sha256 text,
  created_at timestamptz not null default now(),
  unique (project_id, version_number)
);
create index project_versions_project_idx on public.project_versions (project_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_versions enable row level security;

grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select on public.projects to anon, authenticated;
grant insert, update, delete on public.projects to authenticated;
grant select on public.project_versions to anon, authenticated;
grant insert, update, delete on public.project_versions to authenticated;

create policy "Profiles are publicly readable"
on public.profiles for select to anon, authenticated
using (true);

create policy "Users create their own profile"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

create policy "Users update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Published projects are public; owners can see their own"
on public.projects for select to anon, authenticated
using (status = 'published' or (select auth.uid()) = owner_id);

create policy "Signed-in creators submit pending projects"
on public.projects for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and status = 'pending'
);

create policy "Owners edit their own unpublished projects"
on public.projects for update to authenticated
using ((select auth.uid()) = owner_id and status in ('pending', 'rejected'))
with check ((select auth.uid()) = owner_id and status in ('pending', 'rejected'));

create policy "Owners delete their own unpublished projects"
on public.projects for delete to authenticated
using ((select auth.uid()) = owner_id and status in ('pending', 'rejected'));

create policy "Versions for published projects are public"
on public.project_versions for select to anon, authenticated
using (exists (
  select 1 from public.projects p
  where p.id = project_id and p.status = 'published'
));

create policy "Owners view versions for their projects"
on public.project_versions for select to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = project_id and p.owner_id = (select auth.uid())
));

create policy "Owners add versions to unpublished projects"
on public.project_versions for insert to authenticated
with check (exists (
  select 1 from public.projects p
  where p.id = project_id
    and p.owner_id = (select auth.uid())
    and p.status in ('pending', 'rejected')
));

create policy "Owners update versions for unpublished projects"
on public.project_versions for update to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = project_id and p.owner_id = (select auth.uid())
    and p.status in ('pending', 'rejected')
))
with check (exists (
  select 1 from public.projects p
  where p.id = project_id and p.owner_id = (select auth.uid())
    and p.status in ('pending', 'rejected')
));

create policy "Owners delete versions for unpublished projects"
on public.project_versions for delete to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = project_id and p.owner_id = (select auth.uid())
    and p.status in ('pending', 'rejected')
));

-- Keep profile rows in sync with Auth signups.
create or replace function public.handle_new_craftora_user()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_craftora_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_craftora_user();

-- Storage buckets are created here; upload policies will be tightened when file
-- upload UI and virus-scanning/moderation workflow are implemented.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('project-assets', 'project-assets', true, 5242880,
    array['image/png','image/jpeg','image/webp','image/gif']),
  ('project-files', 'project-files', false, 104857600,
    array['application/zip','application/java-archive','application/octet-stream'])
on conflict (id) do nothing;

create policy "Public can view project assets"
on storage.objects for select to anon, authenticated
using (bucket_id = 'project-assets');

create policy "Signed-in users upload assets to their own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Signed-in users view their own uploaded assets"
on storage.objects for select to authenticated
using (
  bucket_id = 'project-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Signed-in users upload project files to their own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Signed-in users view their own project files"
on storage.objects for select to authenticated
using (
  bucket_id = 'project-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
