-- Lose It & Love It: GLP-1 medicine tracking, daily check-ins (mood, energy,
-- appetite, water, symptoms) and the GLP-1 plan on the profile.
-- Paste into Supabase Dashboard -> SQL Editor -> Run (safe to re-run).

-- ---------- medication_doses ----------
create table if not exists public.medication_doses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  taken_at timestamptz not null default now(),
  med text not null check (char_length(med) between 1 and 40),        -- catalogue id, e.g. 'mounjaro'
  med_name text not null check (char_length(med_name) between 1 and 80),
  dose numeric(7, 2) not null check (dose > 0 and dose <= 1000),
  unit text not null default 'mg' check (unit in ('mg', 'mcg')),
  route text not null default 'injection' check (route in ('injection', 'oral')),
  site text check (site in ('abdomen-ul', 'abdomen-ur', 'abdomen-ll', 'abdomen-lr', 'thigh-l', 'thigh-r', 'arm-l', 'arm-r')),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists medication_doses_user_taken_idx on public.medication_doses (user_id, taken_at desc);
create index if not exists medication_doses_user_date_idx on public.medication_doses (user_id, log_date);

-- ---------- daily_logs (one row per day) ----------
create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  mood smallint check (mood between 1 and 5),
  energy smallint check (energy between 1 and 5),
  appetite smallint check (appetite between 1 and 5),
  water_ml int not null default 0 check (water_ml between 0 and 15000),
  symptoms jsonb not null default '[]'::jsonb check (jsonb_typeof(symptoms) = 'array'),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, log_date)
);

drop trigger if exists daily_logs_touch on public.daily_logs;
create trigger daily_logs_touch before update on public.daily_logs
  for each row execute function public.touch_updated_at();

-- ---------- Row Level Security ----------
alter table public.medication_doses enable row level security;
alter table public.daily_logs enable row level security;

drop policy if exists "own doses" on public.medication_doses;
create policy "own doses" on public.medication_doses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own daily logs" on public.daily_logs;
create policy "own daily logs" on public.daily_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- GLP-1 plan and water goal on the profile ----------
alter table public.profiles add column if not exists glp1_med text check (char_length(glp1_med) <= 40);
alter table public.profiles add column if not exists glp1_name text check (char_length(glp1_name) <= 80);
alter table public.profiles add column if not exists glp1_dose numeric(7, 2) check (glp1_dose > 0 and glp1_dose <= 1000);
alter table public.profiles add column if not exists glp1_unit text check (glp1_unit in ('mg', 'mcg'));
alter table public.profiles add column if not exists glp1_frequency text check (glp1_frequency in ('weekly', 'daily', 'twice_daily'));
alter table public.profiles add column if not exists glp1_started_on date;
alter table public.profiles add column if not exists water_target_ml int check (water_target_ml between 500 and 8000);
