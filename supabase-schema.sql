-- BTBU cloud-sync schema (per ADR-0001)
-- Paste this into the Supabase SQL editor on a fresh project. It is
-- idempotent: running it twice is safe.
--
-- Design summary:
--   * One table, sync_records, holds every synced row from any client.
--   * Each row is owned by a Supabase auth user (auth.uid()).
--   * Payloads are CIPHERTEXT — the server only sees the encrypted blob,
--     a record id, a Lamport clock, and a tombstone flag.
--   * Row-Level Security keeps users from reading or writing each
--     other's rows. The anon key shipped to the browser is harmless
--     without a logged-in session because RLS denies by default.

create extension if not exists "pgcrypto";

create table if not exists public.sync_records (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  record_id   text        not null,
  -- Logical (Lamport) clock. Higher wins. Stored as bigint so we can
  -- comfortably tick once per ms for the lifetime of a user.
  updated_at  bigint      not null,
  -- True when the client wants the row deleted everywhere. We keep the
  -- tombstone row so other devices learn about the delete on next pull.
  tombstone   boolean     not null default false,
  -- Opaque ciphertext blob. Format is defined by the client:
  --   { v: 1, iv: <base64>, ct: <base64> }   (AES-GCM-256, PBKDF2 key)
  payload     jsonb,
  -- Server-side audit timestamp; never used for ordering.
  server_at   timestamptz not null default now(),

  primary key (user_id, record_id)
);

create index if not exists sync_records_user_updated_idx
  on public.sync_records (user_id, updated_at);

alter table public.sync_records enable row level security;

-- One policy per verb, all keyed to auth.uid() = user_id.
-- "create policy if not exists" is not supported in older PG; drop-then-create
-- is the safe idempotent shape.
drop policy if exists sync_records_select on public.sync_records;
create policy sync_records_select
  on public.sync_records for select
  using (auth.uid() = user_id);

drop policy if exists sync_records_insert on public.sync_records;
create policy sync_records_insert
  on public.sync_records for insert
  with check (auth.uid() = user_id);

drop policy if exists sync_records_update on public.sync_records;
create policy sync_records_update
  on public.sync_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists sync_records_delete on public.sync_records;
create policy sync_records_delete
  on public.sync_records for delete
  using (auth.uid() = user_id);

-- Optional: cap per-user row count at the DB level so a buggy client
-- can't run away. ~5000 rows comfortably covers a decade of habits +
-- completions.
create or replace function public.sync_records_cap()
returns trigger language plpgsql as $$
declare
  cnt integer;
begin
  select count(*) into cnt from public.sync_records where user_id = new.user_id;
  if cnt > 5000 then
    raise exception 'sync_records cap exceeded for user %', new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists sync_records_cap_t on public.sync_records;
create trigger sync_records_cap_t
  after insert on public.sync_records
  for each row execute function public.sync_records_cap();
