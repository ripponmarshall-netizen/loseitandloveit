-- Lose It & Love It: workouts (treadmill + at-home) and exercise eat-back.
-- Paste into Supabase Dashboard -> SQL Editor -> Run (safe to re-run).

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  kind text not null check (kind in ('treadmill', 'home')),
  name text not null check (char_length(name) between 1 and 120),
  duration_min numeric(5, 1) not null check (duration_min > 0 and duration_min <= 600),
  -- treadmill (stored metric; the app converts for display)
  speed_kmh numeric(4, 1) check (speed_kmh > 0 and speed_kmh <= 25),
  incline_pct numeric(4, 1) check (incline_pct between -5 and 40),
  distance_km numeric(5, 2) check (distance_km >= 0 and distance_km <= 100),
  mode text check (mode in ('walk', 'run')),
  -- at-home
  activity text check (activity in ('bodyweight', 'weights', 'hiit', 'skipping', 'mobility')),
  intensity text check (intensity in ('light', 'moderate', 'hard')),
  exercises jsonb not null default '[]'::jsonb,
  -- net calories (above resting); 'manual' when the user typed their own number
  calories_burned int not null default 0 check (calories_burned between 0 and 5000),
  calories_source text not null default 'estimate' check (calories_source in ('estimate', 'manual')),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists workouts_user_date_idx on public.workouts (user_id, log_date);

alter table public.workouts enable row level security;
drop policy if exists "own workouts" on public.workouts;
create policy "own workouts" on public.workouts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Share of exercise calories added back to the daily food target.
alter table public.profiles
  add column if not exists exercise_eatback_pct int not null default 0
  check (exercise_eatback_pct in (0, 25, 50, 100));
