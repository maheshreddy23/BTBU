-- BTBU v27 — Community schema.
-- Run in Supabase → SQL Editor AFTER docs/supabase-schema.sql and docs/supabase-schema-v25.sql.
-- Idempotent: safe to run twice.
--
-- Privacy model
--   * Habits stay in sync_records as ciphertext. Nothing here reads them.
--   * Community only stores what a user chooses to post, plus one boolean per day
--     ("closed every habit today") that is visible to people who share a circle with them.
--   * Private profiles: posts and stories are visible only to accepted followers.
--   * Blocks hide both people from each other everywhere.
--   * Posts, comments, messages, stories and check-ins containing a banned word are saved
--     with held = true and are visible only to their author until a moderator clears them.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  handle          text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  name            text not null default '' check (char_length(name) <= 40),
  bio             text not null default '' check (char_length(bio) <= 160),
  avatar_url      text,
  is_private      boolean not null default false,
  adult_confirmed boolean not null default false check (adult_confirmed),
  created_at      timestamptz not null default now()
);

create table if not exists public.follows (
  follower   uuid not null references public.profiles(user_id) on delete cascade,
  followee   uuid not null references public.profiles(user_id) on delete cascade,
  status     text not null default 'accepted' check (status in ('accepted','pending')),
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee_idx on public.follows (followee, status);

create table if not exists public.blocks (
  blocker uuid not null references public.profiles(user_id) on delete cascade,
  blocked uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
create table if not exists public.mutes (
  muter uuid not null references public.profiles(user_id) on delete cascade,
  muted uuid not null references public.profiles(user_id) on delete cascade,
  primary key (muter, muted)
);

-- ---------------------------------------------------------------- helpers
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;

create or replace function public.can_view(author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select author = auth.uid() or (
    auth.uid() is not null
    and not is_blocked_between(auth.uid(), author)
    and (
      not coalesce((select is_private from profiles where user_id = author), false)
      or exists (select 1 from follows where follower = auth.uid() and followee = author and status = 'accepted')
    )
  );
$$;

create table if not exists public.banned_words (word text primary key);
insert into public.banned_words(word) values
  ('idiot'),('stupid'),('loser'),('ugly'),('fatso'),('worthless'),('retard'),('slut'),('whore'),('kys')
on conflict do nothing;

create or replace function public.contains_banned(t text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from banned_words w where coalesce(t, '') ~* ('\m' || w.word || '\M'));
$$;

-- Generic "hold for review" trigger. Each table names its text column in TG_ARGV[0].
create or replace function public.hold_if_banned()
returns trigger language plpgsql security definer set search_path = public as $$
declare txt text;
begin
  execute format('select ($1).%I::text', TG_ARGV[0]) into txt using new;
  new.held := contains_banned(txt);
  return new;
end $$;

-- ---------------------------------------------------------------- challenges
create table if not exists public.challenges (
  id         uuid primary key default gen_random_uuid(),
  host       uuid not null references public.profiles(user_id) on delete cascade,
  title      text not null check (char_length(title) between 3 and 60),
  habit      text not null default '' check (char_length(habit) <= 80),
  category   text not null default 'Other',
  cover      text not null default 'violet',
  days       int  not null check (days between 3 and 75),
  starts_on  date not null,
  held       boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.challenge_members (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id      uuid not null references public.profiles(user_id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create table if not exists public.checkins (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id      uuid not null references public.profiles(user_id) on delete cascade,
  day          date not null,
  media_url    text not null,
  media_kind   text not null check (media_kind in ('photo','video')),
  caption      text not null default '' check (char_length(caption) <= 280),
  held         boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (challenge_id, user_id, day)
);

-- ---------------------------------------------------------------- posts
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  author       uuid not null references public.profiles(user_id) on delete cascade,
  body         text not null default '' check (char_length(body) <= 2000),
  media_url    text,
  media_kind   text check (media_kind in ('photo','video')),
  card_n       int,
  challenge_id uuid references public.challenges(id) on delete set null,
  quote_of     uuid references public.posts(id) on delete set null,
  held         boolean not null default false,
  created_at   timestamptz not null default now(),
  check (body <> '' or media_url is not null or card_n is not null)
);
create index if not exists posts_author_created_idx on public.posts (author, created_at desc);
create index if not exists posts_created_idx on public.posts (created_at desc);

create table if not exists public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists public.reposts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  author     uuid not null references public.profiles(user_id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  held       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);

create table if not exists public.stories (
  id         uuid primary key default gen_random_uuid(),
  author     uuid not null references public.profiles(user_id) on delete cascade,
  body       text not null default '' check (char_length(body) <= 120),
  bg         text not null default 'violet',
  media_url  text,
  media_kind text check (media_kind in ('photo','video')),
  held       boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

-- ---------------------------------------------------------------- circles
create table if not exists public.circles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 40),
  owner       uuid not null references public.profiles(user_id) on delete cascade,
  invite_code text not null unique default substr(md5(gen_random_uuid()::text), 1, 8),
  created_at  timestamptz not null default now()
);
create table if not exists public.circle_members (
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id   uuid not null references public.profiles(user_id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);
create table if not exists public.circle_messages (
  id         bigserial primary key,
  circle_id  uuid not null references public.circles(id) on delete cascade,
  author     uuid not null references public.profiles(user_id) on delete cascade,
  kind       text not null default 'text' check (kind in ('text','nudge')),
  body       text not null default '' check (char_length(body) <= 1000),
  target     uuid references public.profiles(user_id) on delete cascade,
  day        date not null default current_date,
  held       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists circle_messages_circle_idx on public.circle_messages (circle_id, id);
-- One nudge per sender → target per circle per day.
create unique index if not exists circle_nudge_once on public.circle_messages (circle_id, author, target, day) where kind = 'nudge';

-- "Closed every habit today" — the only habit-derived signal that leaves the device.
create table if not exists public.day_status (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  day     date not null,
  done    boolean not null default false,
  primary key (user_id, day)
);

create or replace function public.is_circle_member(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from circle_members where circle_id = c and user_id = auth.uid());
$$;
create or replace function public.shares_circle(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from circle_members a join circle_members b on a.circle_id = b.circle_id
                 where a.user_id = auth.uid() and b.user_id = other);
$$;

-- ---------------------------------------------------------------- reports
create table if not exists public.reports (
  id          bigserial primary key,
  reporter    uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  target_kind text not null check (target_kind in ('post','comment','profile','challenge','message','story','checkin')),
  target_id   text not null,
  reason      text not null check (char_length(reason) <= 200),
  status      text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- triggers
create or replace function public.follow_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := case when (select is_private from profiles where user_id = new.followee) then 'pending' else 'accepted' end;
  end if;
  return new;
end $$;
drop trigger if exists follows_status_t on public.follows;
create trigger follows_status_t before insert on public.follows for each row execute function public.follow_status();

create or replace function public.circle_add_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into circle_members(circle_id, user_id) values (new.id, new.owner) on conflict do nothing;
  return new;
end $$;
drop trigger if exists circles_owner_t on public.circles;
create trigger circles_owner_t after insert on public.circles for each row execute function public.circle_add_owner();

create or replace function public.challenge_add_host()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into challenge_members(challenge_id, user_id) values (new.id, new.host) on conflict do nothing;
  return new;
end $$;
drop trigger if exists challenges_host_t on public.challenges;
create trigger challenges_host_t after insert on public.challenges for each row execute function public.challenge_add_host();

drop trigger if exists posts_hold_t on public.posts;
create trigger posts_hold_t before insert or update on public.posts for each row execute function public.hold_if_banned('body');
drop trigger if exists comments_hold_t on public.comments;
create trigger comments_hold_t before insert or update on public.comments for each row execute function public.hold_if_banned('body');
drop trigger if exists stories_hold_t on public.stories;
create trigger stories_hold_t before insert or update on public.stories for each row execute function public.hold_if_banned('body');
drop trigger if exists messages_hold_t on public.circle_messages;
create trigger messages_hold_t before insert or update on public.circle_messages for each row execute function public.hold_if_banned('body');
drop trigger if exists checkins_hold_t on public.checkins;
create trigger checkins_hold_t before insert or update on public.checkins for each row execute function public.hold_if_banned('caption');
drop trigger if exists challenges_hold_t on public.challenges;
create trigger challenges_hold_t before insert or update on public.challenges for each row execute function public.hold_if_banned('title');

-- ---------------------------------------------------------------- RPCs
create or replace function public.join_circle(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; n int;
begin
  select id into cid from circles where invite_code = lower(trim(code));
  if cid is null then raise exception 'No circle with that code'; end if;
  select count(*) into n from circle_members where circle_id = cid;
  if n >= 12 then raise exception 'That circle is full (12 people)'; end if;
  insert into circle_members(circle_id, user_id) values (cid, auth.uid()) on conflict do nothing;
  return cid;
end $$;

create or replace function public.challenge_leaderboard(cid uuid, following_only boolean default false)
returns table (user_id uuid, handle text, name text, avatar_url text, checkins bigint)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.handle, p.name, p.avatar_url, count(c.day)
  from challenge_members m
  join profiles p on p.user_id = m.user_id
  left join checkins c on c.challenge_id = m.challenge_id and c.user_id = m.user_id and not c.held
  where m.challenge_id = cid
    and not is_blocked_between(auth.uid(), m.user_id)
    and (not following_only or m.user_id = auth.uid()
         or exists (select 1 from follows f where f.follower = auth.uid() and f.followee = m.user_id and f.status = 'accepted'))
  group by m.user_id, p.handle, p.name, p.avatar_url
  order by count(c.day) desc, p.handle
  limit 50;
$$;

-- ---------------------------------------------------------------- RLS
alter table public.profiles          enable row level security;
alter table public.follows           enable row level security;
alter table public.blocks            enable row level security;
alter table public.mutes             enable row level security;
alter table public.banned_words      enable row level security;
alter table public.challenges        enable row level security;
alter table public.challenge_members enable row level security;
alter table public.checkins          enable row level security;
alter table public.posts             enable row level security;
alter table public.likes             enable row level security;
alter table public.reposts           enable row level security;
alter table public.comments          enable row level security;
alter table public.stories           enable row level security;
alter table public.circles           enable row level security;
alter table public.circle_members    enable row level security;
alter table public.circle_messages   enable row level security;
alter table public.day_status        enable row level security;
alter table public.reports           enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and policyname like 'c27_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles: any signed-in user can see a profile header (not blocked); only you can write yours.
create policy c27_profiles_sel on public.profiles for select using (auth.uid() is not null and not is_blocked_between(auth.uid(), user_id));
create policy c27_profiles_ins on public.profiles for insert with check (user_id = auth.uid());
create policy c27_profiles_upd on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy c27_profiles_del on public.profiles for delete using (user_id = auth.uid());

create policy c27_follows_sel on public.follows for select using (follower = auth.uid() or followee = auth.uid() or status = 'accepted');
create policy c27_follows_ins on public.follows for insert with check (follower = auth.uid() and not is_blocked_between(follower, followee));
create policy c27_follows_upd on public.follows for update using (followee = auth.uid()) with check (followee = auth.uid());
create policy c27_follows_del on public.follows for delete using (follower = auth.uid() or followee = auth.uid());

create policy c27_blocks_sel on public.blocks for select using (blocker = auth.uid());
create policy c27_blocks_ins on public.blocks for insert with check (blocker = auth.uid());
create policy c27_blocks_del on public.blocks for delete using (blocker = auth.uid());
create policy c27_mutes_sel on public.mutes for select using (muter = auth.uid());
create policy c27_mutes_ins on public.mutes for insert with check (muter = auth.uid());
create policy c27_mutes_del on public.mutes for delete using (muter = auth.uid());

create policy c27_ch_sel on public.challenges for select using (auth.uid() is not null and (host = auth.uid() or (not held and not is_blocked_between(auth.uid(), host))));
create policy c27_ch_ins on public.challenges for insert with check (host = auth.uid());
create policy c27_ch_upd on public.challenges for update using (host = auth.uid()) with check (host = auth.uid());
create policy c27_ch_del on public.challenges for delete using (host = auth.uid());

create policy c27_cm_sel on public.challenge_members for select using (auth.uid() is not null);
create policy c27_cm_ins on public.challenge_members for insert with check (user_id = auth.uid());
create policy c27_cm_del on public.challenge_members for delete using (user_id = auth.uid());

create policy c27_ci_sel on public.checkins for select using (user_id = auth.uid() or (not held and not is_blocked_between(auth.uid(), user_id)));
create policy c27_ci_ins on public.checkins for insert with check (
  user_id = auth.uid() and day between current_date - 1 and current_date + 1
  and exists (select 1 from challenge_members m where m.challenge_id = checkins.challenge_id and m.user_id = auth.uid()));
create policy c27_ci_del on public.checkins for delete using (user_id = auth.uid());

create policy c27_posts_sel on public.posts for select using (author = auth.uid() or (not held and can_view(author)));
create policy c27_posts_ins on public.posts for insert with check (author = auth.uid());
create policy c27_posts_del on public.posts for delete using (author = auth.uid());

create policy c27_likes_sel on public.likes for select using (auth.uid() is not null);
create policy c27_likes_ins on public.likes for insert with check (user_id = auth.uid());
create policy c27_likes_del on public.likes for delete using (user_id = auth.uid());
create policy c27_rp_sel on public.reposts for select using (auth.uid() is not null and not is_blocked_between(auth.uid(), user_id));
create policy c27_rp_ins on public.reposts for insert with check (user_id = auth.uid());
create policy c27_rp_del on public.reposts for delete using (user_id = auth.uid());

create policy c27_com_sel on public.comments for select using (author = auth.uid() or (not held and not is_blocked_between(auth.uid(), author)));
create policy c27_com_ins on public.comments for insert with check (
  author = auth.uid() and exists (select 1 from posts p where p.id = comments.post_id and can_view(p.author)));
create policy c27_com_del on public.comments for delete using (
  author = auth.uid() or exists (select 1 from posts p where p.id = comments.post_id and p.author = auth.uid()));

create policy c27_st_sel on public.stories for select using (author = auth.uid() or (not held and expires_at > now() and can_view(author)));
create policy c27_st_ins on public.stories for insert with check (author = auth.uid());
create policy c27_st_del on public.stories for delete using (author = auth.uid());

create policy c27_circ_sel on public.circles for select using (is_circle_member(id) or owner = auth.uid());
create policy c27_circ_ins on public.circles for insert with check (owner = auth.uid());
create policy c27_circ_upd on public.circles for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy c27_circ_del on public.circles for delete using (owner = auth.uid());

create policy c27_cmem_sel on public.circle_members for select using (is_circle_member(circle_id));
create policy c27_cmem_del on public.circle_members for delete using (
  user_id = auth.uid() or exists (select 1 from circles c where c.id = circle_members.circle_id and c.owner = auth.uid()));

create policy c27_msg_sel on public.circle_messages for select using (is_circle_member(circle_id) and (not held or author = auth.uid()));
create policy c27_msg_ins on public.circle_messages for insert with check (
  author = auth.uid() and is_circle_member(circle_id)
  and (kind = 'text' or (target is not null and target <> auth.uid()
       and exists (select 1 from circle_members m where m.circle_id = circle_messages.circle_id and m.user_id = target))));

create policy c27_ds_sel on public.day_status for select using (user_id = auth.uid() or shares_circle(user_id));
create policy c27_ds_ins on public.day_status for insert with check (user_id = auth.uid());
create policy c27_ds_upd on public.day_status for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy c27_rep_ins on public.reports for insert with check (reporter = auth.uid());
create policy c27_rep_sel on public.reports for select using (reporter = auth.uid());
-- banned_words: no policies → readable only by the service role / SQL editor.

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 26214400,
        array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;

drop policy if exists c27_media_ins on storage.objects;
create policy c27_media_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists c27_media_del on storage.objects;
create policy c27_media_del on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists c27_media_sel on storage.objects;
create policy c27_media_sel on storage.objects for select using (bucket_id = 'media');
