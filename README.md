# Lose It & Love It

A phone-first calorie tracker PWA with a Claude-powered coach. It has Jamaican foods built in and handles shift work.

**Stack:** React 19 + Vite 8 (static site on GitHub Pages) · Supabase (Postgres + Auth + one Edge Function) · Claude API (only called from the Edge Function).

## What v1 does

| Area | Features |
|---|---|
| Log | Four meals per day, a servings stepper, edit and delete, "copy the day before" |
| Add food | Search 58 built-in Jamaican staples and basics, your saved foods and recent items. **AI estimate** from a text description and/or a photo. Quick add. |
| Targets | Mifflin-St Jeor BMR × activity, minus the deficit for your chosen pace. Safety floor (1200/1500 kcal) and a cap of 1% body weight per week. Protein, carbs and fat targets. Manual overrides. |
| Weight | Weigh-ins, a smoothed trend line (gap-aware EMA), weekly rate, goal ETA |
| Exercise | **Treadmill** (minutes, speed, incline, walk/run) and **at-home workouts** (bodyweight, dumbbells, HIIT, skipping, mobility) with exercise lists and presets. Net burn from the ACSM treadmill equations or MET values. Optional "eat back" of 0/25/50/100% to the food target. Weekly summary on Progress. |
| Adaptive maintenance | Works out your *real* TDEE from logged intake vs trend change (needs about 2–3 weeks of data). One tap to re-base your target on it. |
| Coach | Streaming chat with Claude. Each message carries a compact snapshot: targets, the last 14 days, today's log, workouts, trend, adaptive TDEE and your coach notes. |
| Shift work | "My day starts at" setting (default 4 am), so a 2 am meal after a night shift counts toward the previous day |
| Data | Export to JSON (backup) or CSV (Sheets/Excel), import JSON. Local-only mode with no account. |
| PWA | Installable on iPhone, offline app shell, light and dark mode |

## One-time setup (all from an iPhone browser)

The Supabase project `loseitandloveit` already exists, and its URL and publishable key are in `src/config.js`. The publishable key is designed to be public: Row Level Security protects the data.

### 1. Database (2 min)
Supabase Dashboard → **SQL Editor** → New query → paste each file in order and **Run** it. Each one is safe to re-run.
1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql): core tables
2. [`supabase/migrations/0002_workouts.sql`](supabase/migrations/0002_workouts.sql): workouts and the exercise eat-back setting

### 2. Auth (2 min)
Dashboard → **Authentication → URL Configuration**:
- **Site URL:** `https://ripponmarshall-netizen.github.io/loseitandloveit/`
- **Redirect URLs:** add the same URL.

Create your account in the app. Then, under **Authentication → Sign In / Providers**, turn off **Allow new users to sign up** so strangers can't make accounts.

### 3. AI Edge Function (5 min)
Dashboard → **Edge Functions** → Deploy a new function → **Via Editor** → name it `ai` → paste [`supabase/functions/ai/index.ts`](supabase/functions/ai/index.ts) → Deploy.
Then, in the function's **Details**, turn **JWT verification OFF** (the toggle name varies a little between dashboard versions). The function checks the user itself, and this avoids issues with the newer JWT signing keys.

Dashboard → **Edge Functions → Secrets**, add:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com |
| `ALLOWED_EMAILS` | the email you signed up with (comma-separate more) |
| `COACH_MODEL` *(optional)* | default `claude-haiku-5-5` |
| `ESTIMATE_MODEL` *(optional)* | default `claude-haiku-5-5` |
| `AI_DAILY_LIMIT` *(optional)* | default `60` requests/user/day |

The AI stays **locked** until `ALLOWED_EMAILS` is set. This is deliberate: anyone who finds the URL could otherwise spend your API credit.

### 4. GitHub Pages (2 min)
Repo → **Settings → Pages → Source: GitHub Actions**. Every push to `main` runs the tests, builds and deploys `.github/workflows/deploy.yml`. You can also run it by hand from the **Actions** tab.

### 5. Install
Open the Pages URL in Safari → Share → **Add to Home Screen**.

## If the coach doesn't answer

The app shows the function's error message. Check Supabase → Edge Functions → `ai` → Logs; each cold start logs a line like `[ai] key: found in "ANTHROPIC_API_KEY"; allowlist: 1 email(s); custom secrets: …` (names only, never values).

| Message | Fix |
|---|---|
| *AI not set up: no ANTHROPIC_API_KEY found* | Add the secret under **Edge Functions → Secrets** (not GitHub secrets, not Vault), named `ANTHROPIC_API_KEY`. The message lists the names it can see. |
| *AI is locked* / *email isn't in the ALLOWED_EMAILS secret* | Set `ALLOWED_EMAILS` to exactly the email you sign in with. |
| *Anthropic rejected the API key* | The key was revoked or mistyped. Make a new one at console.anthropic.com. |
| *Your Anthropic account has no credit* | Add credit at console.anthropic.com → Billing. |

## Cost and model notes

- Both AI features use **Claude Haiku 5.5**: $0.10 in / $0.50 out per million tokens for prompts up to 100K tokens (every request here is far below that). A coach reply is roughly 3–6k input and 0.5–2k output tokens, about **US$0.001 per message**. A photo estimate is a fraction of a cent. Check current pricing before budgeting on it.
- Both run at `medium` effort. If coaching feels shallow, try `COACH_EFFORT=high` first, then a bigger model (`claude-sonnet-5-5` or `claude-opus-5-5`, set via `COACH_MODEL`).
- Haiku 5.5 has no server-side refusal fallback. If a safety classifier declines, the app shows "try asking another way". Fallback (`fallbacks: "default"`) switches on automatically if you move to an Opus or Sonnet model.
- The system prompt and conversation history use prompt caching. **Settings → AI usage today** shows the tokens you've used.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # node:test unit tests for the maths (src/lib/calc.js, dates.js)
npm run build
```

Without a terminal, edit files on github.com (or ask Claude Code). Pushing to `main` redeploys.

## Project map

```
src/
  App.jsx               auth gate, onboarding, tabs, shared state
  appContext.js         useApp() hook
  config.js             Supabase URL + publishable key
  lib/calc.js           BMR/TDEE/targets, trend, weekly rate, adaptive TDEE, units
  lib/dates.js          local dates + shift-aware "logical today"
  lib/db.js             data layer: cloud (Supabase) and local (localStorage)
  lib/ai.js             calls the Edge Function (streaming coach, meal estimate, photo resize)
  lib/coachContext.js   the data snapshot sent to the coach
  data/foods.js         built-in Jamaican foods (estimates, edit freely)
  components/           Today, AddFood, Progress, Coach, Settings, ProfileForm, Charts, ui
supabase/
  migrations/0001_init.sql   tables + RLS + AI usage functions
  functions/ai/index.ts      Claude API proxy (coach + estimate), allowlist, daily cap
tests/calc.test.js
```

## Known limits / next steps

1. **Offline logging.** The app shell works offline, but saving needs a connection. Next: an outbox queue in `db.js`.
2. **Food database.** Built-ins are approximate. Next: verify the top 20 foods against labels and recipes, and add Open Food Facts barcode lookup (check Jamaican product coverage first).
3. **Weekly check-in.** A scheduled coach summary every Sunday (Supabase cron → Edge Function).
4. **Water and steps.** Exercise is logged; water and steps aren't yet.
5. **Tests.** Add Playwright smoke tests to CI.

Built-in nutrition values and AI estimates are estimates, not medical advice.
