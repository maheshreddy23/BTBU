-- BTBU v26 — Web Push reminder subscriptions.
-- Run once in Supabase → SQL Editor.
create table if not exists public.push_subscriptions (
  endpoint     text primary key,
  subscription jsonb not null,
  remind_at    text not null default '20:00',   -- "HH:MM", user's local time
  tz           text not null default 'Asia/Kolkata',
  last_sent_on date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Only the edge function (service role) touches this table.
alter table public.push_subscriptions enable row level security;
