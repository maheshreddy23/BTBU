-- BTBU v25 — globally-unique usernames.
-- Paste into the Supabase SQL editor on the same project that already has
-- sync_records (from docs/supabase-schema.sql). Idempotent; safe to re-run.
--
-- Design:
--   * The username column itself is the primary key, which gives us the
--     global uniqueness guarantee for free at the database level.
--   * user_id has a UNIQUE constraint, enforcing one handle per user.
--   * RLS lets any authenticated user SELECT (so the client can probe
--     availability while typing), but only the owner can INSERT, UPDATE
--     their own row, or DELETE it.
--   * Names stored lowercase to make availability checks trivially
--     case-insensitive.

create table if not exists public.usernames (
  username   text        primary key,
  user_id    uuid        not null unique
              references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

-- Enforce length + character rules at the DB layer too. We sanitize on
-- the client first, so this is a belt-and-suspenders guard against a
-- malicious or buggy client.
alter table public.usernames
  drop constraint if exists usernames_format_chk;
alter table public.usernames
  add constraint usernames_format_chk
  check (username ~ '^[a-z0-9_]{3,20}$');

alter table public.usernames enable row level security;

drop policy if exists usernames_select on public.usernames;
create policy usernames_select
  on public.usernames for select
  to authenticated using (true);

drop policy if exists usernames_insert on public.usernames;
create policy usernames_insert
  on public.usernames for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists usernames_update on public.usernames;
create policy usernames_update
  on public.usernames for update
  to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists usernames_delete on public.usernames;
create policy usernames_delete
  on public.usernames for delete
  to authenticated using (auth.uid() = user_id);
