-- Lose It & Love It: initial schema.
-- Paste into Supabase Dashboard -> SQL Editor -> Run (safe to re-run).
-- Every table is locked down with Row Level Security: a signed-in user can
-- only see and change their own rows.

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  sex text check (sex in ('male', 'female')),
  birth_year int check (birth_year between 1900 and 2100),
  height_cm numeric(5, 1) check (height_cm between 100 and 250),
  start_weight_kg numeric(5, 1) check (start_weight_kg between 30 and 350),
  goal_weight_kg numeric(5, 1) check (goal_weight_kg between 30 and 350),
  activity_level text default 'light'
    check (activity_level in ('sedentary', 'light', 'moderate', 'active', 'athlete')),
  weekly_rate_kg numeric(3, 2) default 0.5 check (weekly_rate_kg between 0 and 1.5),
  units text default 'imperial' check (units in ('metric', 'imperial')),
  day_start_hour int default 4 check (day_start_hour between 0 and 12),
  calorie_target_override int check (calorie_target_override between 800 and 6000),
  protein_target_override int check (protein_target_override between 20 and 400),
  coach_notes text check (char_length(coach_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- foods (your saved foods) ----------
create table if not exists public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  serving text,
  calories numeric(7, 1) not null default 0 check (calories >= 0),
  protein_g numeric(6, 1) not null default 0 check (protein_g >= 0),
  carbs_g numeric(6, 1) not null default 0 check (carbs_g >= 0),
  fat_g numeric(6, 1) not null default 0 check (fat_g >= 0),
  created_at timestamptz not null default now()
);
create index if not exists foods_user_idx on public.foods (user_id);

-- ---------- food_entries (the log) ----------
-- Nutrients are per serving; totals = value * servings.
create table if not exists public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  name text not null check (char_length(name) between 1 and 200),
  serving text,
  servings numeric(5, 2) not null default 1 check (servings > 0 and servings <= 50),
  calories numeric(7, 1) not null default 0 check (calories >= 0),
  protein_g numeric(6, 1) not null default 0 check (protein_g >= 0),
  carbs_g numeric(6, 1) not null default 0 check (carbs_g >= 0),
  fat_g numeric(6, 1) not null default 0 check (fat_g >= 0),
  source text not null default 'manual' check (source in ('manual', 'library', 'recent', 'ai', 'quick')),
  food_id uuid references public.foods (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists food_entries_user_date_idx on public.food_entries (user_id, log_date);
create index if not exists food_entries_user_created_idx on public.food_entries (user_id, created_at desc);
create index if not exists food_entries_food_idx on public.food_entries (food_id);

-- ---------- weights (one per day) ----------
create table if not exists public.weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  weight_kg numeric(5, 2) not null check (weight_kg between 30 and 350),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, log_date)
);

-- ---------- coach_messages ----------
create table if not exists public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 20000),
  created_at timestamptz not null default now()
);
create index if not exists coach_messages_user_created_idx on public.coach_messages (user_id, created_at desc);

-- ---------- ai_usage (written only by the Edge Function) ----------
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  requests int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);

-- ---------- updated_at trigger ----------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.foods enable row level security;
alter table public.food_entries enable row level security;
alter table public.weights enable row level security;
alter table public.coach_messages enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "own foods" on public.foods;
create policy "own foods" on public.foods for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own entries" on public.food_entries;
create policy "own entries" on public.food_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own weights" on public.weights;
create policy "own weights" on public.weights for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own coach messages" on public.coach_messages;
create policy "own coach messages" on public.coach_messages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Users can read their own AI usage; only the service role (Edge Function) writes it.
drop policy if exists "read own ai usage" on public.ai_usage;
create policy "read own ai usage" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- AI usage helpers (service role only) ----------
-- Atomically count a request against today's limit. Returns the new count,
-- or -1 if the limit was already reached (nothing is incremented then).
create or replace function public.bump_ai_usage(p_user uuid, p_day date, p_limit int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.ai_usage (user_id, day, requests)
  values (p_user, p_day, 1)
  on conflict (user_id, day) do update
    set requests = public.ai_usage.requests + 1
    where public.ai_usage.requests < p_limit
  returning requests into n;
  return coalesce(n, -1);
end;
$$;

create or replace function public.add_ai_tokens(p_user uuid, p_day date, p_in bigint, p_out bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage
     set input_tokens = input_tokens + p_in,
         output_tokens = output_tokens + p_out
   where user_id = p_user and day = p_day;
$$;

revoke all on function public.bump_ai_usage(uuid, date, int) from public, anon, authenticated;
revoke all on function public.add_ai_tokens(uuid, date, bigint, bigint) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid, date, int) to service_role;
grant execute on function public.add_ai_tokens(uuid, date, bigint, bigint) to service_role;
