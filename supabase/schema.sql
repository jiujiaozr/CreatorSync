create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nickname text not null default '创作者',
  avatar_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.content_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  content_type text not null,
  audience text not null,
  preference text not null,
  selected_platforms jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_drafts (
  id uuid primary key default gen_random_uuid(),
  content_record_id uuid not null references public.content_records(id) on delete cascade,
  platform_id text not null,
  platform_name text not null,
  title text not null,
  subtitle text not null,
  body text not null,
  tags jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.publish_records (
  id uuid primary key default gen_random_uuid(),
  content_record_id uuid not null references public.content_records(id) on delete cascade,
  platform_id text not null,
  platform_name text not null,
  state text not null,
  message text not null,
  retry_count integer not null default 0,
  failure_reason text,
  created_at text not null
);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.content_records to authenticated;
grant select, insert, update, delete on public.platform_drafts to authenticated;
grant select, insert, update, delete on public.publish_records to authenticated;

alter table public.profiles enable row level security;
alter table public.content_records enable row level security;
alter table public.platform_drafts enable row level security;
alter table public.publish_records enable row level security;

alter table public.content_records
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

drop policy if exists "profiles are owned by users" on public.profiles;
drop policy if exists "demo content records are public" on public.content_records;
drop policy if exists "content records are owned by users" on public.content_records;
drop policy if exists "demo platform drafts are public" on public.platform_drafts;
drop policy if exists "platform drafts follow content ownership" on public.platform_drafts;
drop policy if exists "demo publish records are public" on public.publish_records;
drop policy if exists "publish records follow content ownership" on public.publish_records;

create policy "profiles are owned by users"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, nickname, updated_at)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'nickname', split_part(coalesce(new.email, ''), '@', 1), '创作者'),
    now()
  )
  on conflict (id) do update
    set email = excluded.email,
        nickname = excluded.nickname,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

create policy "content records are owned by users"
  on public.content_records for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "platform drafts follow content ownership"
  on public.platform_drafts for all
  using (
    exists (
      select 1 from public.content_records
      where content_records.id = platform_drafts.content_record_id
        and content_records.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.content_records
      where content_records.id = platform_drafts.content_record_id
        and content_records.user_id = auth.uid()
    )
  );

create policy "publish records follow content ownership"
  on public.publish_records for all
  using (
    exists (
      select 1 from public.content_records
      where content_records.id = publish_records.content_record_id
        and content_records.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.content_records
      where content_records.id = publish_records.content_record_id
        and content_records.user_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "avatar files are publicly readable" on storage.objects;
drop policy if exists "users can upload their own avatar" on storage.objects;
drop policy if exists "users can update their own avatar" on storage.objects;

create policy "avatar files are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "users can upload their own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "users can update their own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
