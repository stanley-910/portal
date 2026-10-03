-- Profiles: one row per auth user, created by trigger on signup. Idempotent: safe to re-run.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  created_at timestamptz not null default now()
);

-- RLS before any policy.
alter table public.profiles enable row level security;

-- Any signed-in user may read profiles (names show in shared trips).
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated
  using (true);

-- A user may update only their own profile.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Traveller'
      ),
      32
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Only the trigger calls it; don't expose it as an RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
