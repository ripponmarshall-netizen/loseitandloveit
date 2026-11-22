-- Lose It & Love It: sleep and steps from Apple Health, and food the app couldn't find.
-- Paste into Supabase Dashboard -> SQL Editor -> Run (safe to re-run).
--
-- Until this runs, the app keeps working: sleep and steps stay on the phone
-- (they don't reach the account), and missed searches and AI corrections are
-- kept on the phone only.

-- ---------- sleep and steps: one figure per day, on the day's check-in row ----------
-- sleep_min: minutes asleep that ended between 6 pm the evening before and 6 pm that day.
-- steps: the day's step count (the source with the most, as the Health app shows).
alter table public.daily_logs add column if not exists sleep_min int check (sleep_min between 0 and 1440);
alter table public.daily_logs add column if not exists steps int check (steps between 0 and 200000);

-- ---------- food_feedback: what the food list is missing ----------
--   search_miss   a search that found nothing in the app's own lists
--                 (picked = the online result chosen instead, if any)
--   ai_correction an AI estimate changed before it was logged
--                 (est_* = the AI's numbers, kcal etc. = what was logged)
-- Read it in the SQL Editor to see which foods to add to src/data/foods.js:
--   select query, count(*) from food_feedback where kind = 'search_miss' group by 1 order by 2 desc;
create table if not exists public.food_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('search_miss', 'ai_correction')),
  query text check (char_length(query) <= 200),
  picked text check (char_length(picked) <= 200),
  name text check (char_length(name) <= 200),
  serving text check (char_length(serving) <= 200),
  est_kcal numeric(7, 1) check (est_kcal >= 0),
  est_protein_g numeric(6, 1) check (est_protein_g >= 0),
  est_carbs_g numeric(6, 1) check (est_carbs_g >= 0),
  est_fat_g numeric(6, 1) check (est_fat_g >= 0),
  kcal numeric(7, 1) check (kcal >= 0),
  protein_g numeric(6, 1) check (protein_g >= 0),
  carbs_g numeric(6, 1) check (carbs_g >= 0),
  fat_g numeric(6, 1) check (fat_g >= 0),
  created_at timestamptz not null default now()
);
create index if not exists food_feedback_user_created_idx on public.food_feedback (user_id, created_at desc);

alter table public.food_feedback enable row level security;
drop policy if exists "own food feedback" on public.food_feedback;
create policy "own food feedback" on public.food_feedback for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
