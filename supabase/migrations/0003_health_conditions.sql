-- Lose It & Love It: health conditions (PCOS etc.) and weigh-in notes.
-- Paste into Supabase Dashboard -> SQL Editor -> Run (safe to re-run).

-- Self-reported conditions that change targets and coaching.
-- Keys must match CONDITIONS in src/lib/calc.js.
alter table public.profiles
  add column if not exists conditions text[] not null default '{}';

alter table public.profiles drop constraint if exists profiles_conditions_check;
alter table public.profiles add constraint profiles_conditions_check
  check (conditions <@ array['pcos', 'insulin_resistance', 'type2_diabetes', 'hypothyroidism', 'hypertension']::text[]);

-- Weigh-ins can now be edited (date, weight, note). Keep notes short.
alter table public.weights drop constraint if exists weights_note_len;
alter table public.weights add constraint weights_note_len
  check (note is null or char_length(note) <= 300);

-- RLS: the existing "own profile" and "own weights" policies (for all, using
-- user_id = (select auth.uid())) already cover these columns.
