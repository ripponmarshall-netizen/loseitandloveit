-- Lose It & Love It: profile photo and Mimi's check-ins.
-- Paste into Supabase Dashboard -> SQL Editor -> Run (safe to re-run).

-- ---------- Profile photo ----------
-- A small square JPEG (256 px, about 20–40 KB) stored as a data URL, so it
-- needs no Storage bucket and is covered by the profiles RLS policy.
alter table public.profiles
  add column if not exists avatar text
  check (avatar is null or (avatar like 'data:image/%' and char_length(avatar) <= 200000));

-- ---------- Mimi's check-ins ----------
-- Short AI recommendations made every few hours from the user's own log.
create table if not exists public.coach_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  headline text not null check (char_length(headline) between 1 and 200),
  tips jsonb not null default '[]'::jsonb check (jsonb_typeof(tips) = 'array'),
  fingerprint text check (char_length(fingerprint) <= 200),
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists coach_insights_user_created_idx on public.coach_insights (user_id, created_at desc);

alter table public.coach_insights enable row level security;
drop policy if exists "own insights" on public.coach_insights;
create policy "own insights" on public.coach_insights for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
