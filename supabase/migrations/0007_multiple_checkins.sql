-- Lose It & Love It: more than one weigh-in and more than one mood check-in a day.
-- Paste into Supabase Dashboard -> SQL Editor -> Run (safe to re-run).
--
-- Until this runs, the app keeps working: the first weigh-in of a day syncs as
-- before, and a second one on the same day is refused with a message to run
-- this file. Moods still reach daily_logs (the latest one of the day).

-- ---------- weights: many a day, each with a time ----------
alter table public.weights drop constraint if exists weights_user_id_log_date_key;
alter table public.weights add column if not exists weighed_at timestamptz;
create index if not exists weights_user_date_idx on public.weights (user_id, log_date);

-- ---------- mood_logs: each mood check-in through the day ----------
-- daily_logs.mood / energy keep the day's latest check-in, so everything that
-- reads a day's mood keeps working.
create table if not exists public.mood_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  logged_at timestamptz not null default now(),
  mood smallint not null check (mood between 1 and 5),
  energy smallint check (energy between 1 and 5),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists mood_logs_user_date_idx on public.mood_logs (user_id, log_date);

alter table public.mood_logs enable row level security;
drop policy if exists "own mood logs" on public.mood_logs;
create policy "own mood logs" on public.mood_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Earlier days' single mood becomes that day's first check-in. It reuses the
-- daily_logs id (the app does the same on the device), so it is never doubled.
-- created_at, not updated_at: water taps later in the day move updated_at.
insert into public.mood_logs (id, user_id, log_date, logged_at, mood, energy)
select d.id, d.user_id, d.log_date, d.created_at, d.mood, d.energy
  from public.daily_logs d
 where d.mood is not null
on conflict (id) do nothing;
