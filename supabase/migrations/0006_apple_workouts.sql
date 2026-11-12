-- Lose It & Love It: workouts imported from Apple Fitness (Health export).
-- Paste into Supabase Dashboard -> SQL Editor -> Run (safe to re-run).
--
-- Until this runs, imported workouts still sync: types the app has no form
-- for (cycling, swimming...) are saved as at-home workouts instead.

-- 'other': imported types such as cycling, swimming, dance or sport.
alter table public.workouts drop constraint if exists workouts_kind_check;
alter table public.workouts add constraint workouts_kind_check
  check (kind in ('treadmill', 'home', 'other'));

-- 'device': the calories came from the watch/phone (Apple's active energy).
alter table public.workouts drop constraint if exists workouts_calories_source_check;
alter table public.workouts add constraint workouts_calories_source_check
  check (calories_source in ('estimate', 'manual', 'device'));

-- Where the workout came from (null = logged in the app).
alter table public.workouts add column if not exists source text;
alter table public.workouts drop constraint if exists workouts_source_check;
alter table public.workouts add constraint workouts_source_check
  check (source is null or source in ('apple'));

-- RLS: the existing "own workouts" policy (for all, using
-- user_id = (select auth.uid())) already covers these columns.
