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
| Adaptive maintenance | Works out your *real* TDEE from logged intake vs trend change (needs about 2–3 weeks of data). One tap to re-base your target on it. |
| Coach | Streaming chat with Claude. Each message carries a compact snapshot: targets, the last 14 days, today's log, trend, adaptive TDEE and your coach notes. |
| Shift work | "My day starts at" setting (default 4 am), so a 2 am meal after a night shift counts toward the previous day |
| Data | Export to JSON (backup) or CSV (Sheets/Excel), import JSON. Local-only mode with no account. |
| PWA | Installable on iPhone, offline app shell, light and dark mode |

## One-time setup (all from an iPhone browser)

The Supabase project `loseitandloveit` already exists, and its URL and publishable key are in `src/config.js`. The publishable key is designed to be public: Row Level Security protects the data.

### 1. Database (2 min)
Supabase Dashboard → **SQL Editor** → New query → paste all of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → **Run**. It's safe to re-run.

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
| `COACH_MODEL` *(optional)* | default `claude-opus-5-5` |
| `ESTIMATE_MODEL` *(optional)* | default `claude-opus-5-5` |
| `AI_DAILY_LIMIT` *(optional)* | default `60` requests/user/day |

The AI stays **locked** until `ALLOWED_EMAILS` is set. This is deliberate: anyone who finds the URL could otherwise spend your API credit.

### 4. GitHub Pages (2 min)
Repo → **Settings → Pages → Source: GitHub Actions**. Every push to `main` runs the tests, builds and deploys `.github/workflows/deploy.yml`. You can also run it by hand from the **Actions** tab.

### 5. Install
Open the Pages URL in Safari → Share → **Add to Home Screen**.

## Cost and model notes

- Both AI features default to **Claude Opus 5.5** ($4 in / $20 out per million tokens). A coach reply is roughly 3–6k input and 0.5–2k output tokens, about **US$0.02–0.06 per message**. Food estimates are smaller.
- To spend far less, set `COACH_MODEL` / `ESTIMATE_MODEL` to `claude-haiku-5-5` ($0.10/$0.50). Expect weaker coaching nuance; that's your call. **Settings → AI usage today** shows the tokens you've used.
- The system prompt and conversation history use prompt caching. Refusals fall back server-side (`fallbacks: "default"`) on Opus/Sonnet models.

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
4. **Water, steps and exercise logging.** Feed them into adaptive TDEE.
5. **Tests.** Add Playwright smoke tests to CI.

Built-in nutrition values and AI estimates are estimates, not medical advice.
