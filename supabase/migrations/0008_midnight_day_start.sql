-- Lose It & Love It: a new day starts at midnight by default (was 4 am).
-- Paste into Supabase Dashboard -> SQL Editor -> Run once.
--
-- Night-shift workers can still pick a later start in Settings -> Tracking.

alter table public.profiles alter column day_start_hour set default 0;

-- Profiles still on the old 4 am default move to midnight. Run this once:
-- re-running it would also move anyone who has since chosen 4 am again.
update public.profiles set day_start_hour = 0 where day_start_hour = 4;
