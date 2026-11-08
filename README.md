# Lose It & Love It

A phone-first calorie tracker PWA with **Mimi the Penguin**, a Claude-powered coach. It has Jamaican foods built in and handles shift work.

**Stack:** React 19 + Vite 8 (static site on GitHub Pages) · Supabase (Postgres + Auth + one Edge Function) · Claude API (only called from the Edge Function).

## What v1 does

| Area | Features |
|---|---|
| Log | Four meals per day, a servings stepper, edit and delete, "copy the day before" |
| Nutrition breakdown | Tap a meal (or the macro bars for the whole day) to see its calories, a donut chart of where they come from (protein, carbs, fat), its share of your daily targets and each food's share. Editing a food shows its own split. |
| Add food | Search 133 built-in Jamaican staples, cookshop meals and basics, your saved foods and recent items, plus **USDA FoodData Central** and **Open Food Facts** (type a barcode number to look up a packaged product). Log database foods by servings or grams. **AI estimate** from a text description and/or a photo. Quick add. |
| Food databases | The AI estimate and the coach call a `search_food_databases` tool that checks your saved foods, the Jamaican list, USDA and Open Food Facts before giving numbers. Each AI item shows the reference it used. Toggle sources in Settings → Food databases. |
| Targets | Mifflin-St Jeor BMR × activity, minus the deficit for your chosen pace. Safety floor (1200/1500 kcal) and a cap of 1% body weight per week. Protein, carbs and fat targets. Manual overrides. |
| Weight | Weigh-ins, a smoothed trend line (gap-aware EMA), weekly rate, goal ETA |
| Exercise | **Treadmill** (minutes, speed, incline, walk/run) and **at-home workouts** (bodyweight, dumbbells, HIIT, skipping, mobility) with exercise lists and presets. Net burn from the ACSM treadmill equations or MET values. Optional "eat back" of 0/25/50/100% to the food target. Weekly summary on Progress. |
| Adaptive maintenance | Works out your *real* TDEE from logged intake vs trend change (needs about 2–3 weeks of data). One tap to re-base your target on it. |
| Log anything | The centre **+** opens a Log sheet: type "2 glasses water", "30 min walk", "212 lb", "feeling good", "Mounjaro 5 mg" or a food and it goes to the right place. Tiles for meal, drink, water, exercise, mood, weight and GLP-1, with the top two suggested by time of day and what's due. |
| GLP-1 | Ozempic, Wegovy, Rybelsus, Mounjaro, Zepbound, Saxenda, Victoza, Trulicity, Byetta, Bydureon or any other. Log doses with the usual dose ladder, date/time and an **injection-site body map** that suggests the next site to rotate to. Next-dose status on the Dashboard (counting from your plan's start date until the first dose is logged), dose history and weight change since starting on Progress. |
| Check-ins | Daily mood, energy, appetite and symptoms (with an urgent-care warning for red-flag symptoms), and water with one-tap glasses. A 14-day wellbeing summary on Progress. |
| Mimi (coach) | **Mimi the Penguin**: streaming chat with Claude, one tap from the floating penguin bubble on the Dashboard. Each message carries a compact snapshot: targets, the last 14 days, today's log, workouts, trend, adaptive TDEE, GLP-1 plan and recent doses, check-ins and your coach notes. The system prompt has GLP-1 guidance: protein first, eating enough, hydration, side-effect self-care, strength training, red flags; it never advises on dosing. |
| Mimi's check-ins | Every 2 or 3 hours while the app is open, Mimi reads a small snapshot of today's log (food, protein, water, workouts, weigh-in, mood, GLP-1 dose) and leaves 1–3 next steps at the top of the Mimi section; a dot on the Dashboard's penguin bubble shows a new one. Tap a step to log it. Only runs when something changed (or it's been twice the interval), at most 6 a day. Change or turn off in Settings → Mimi. |
| Profile photo | Tap your initial in Settings to add a photo. It's cropped to a 256 px square (about 20–40 KB) and stored on your profile; it shows in Settings, on the Dashboard and beside your messages to Mimi. |
| Shift work | "My day starts at" setting (default 4 am), so a 2 am meal after a night shift counts toward the previous day |
| Data | Export to JSON (backup) or CSV (Sheets/Excel), import JSON. Local-only mode with no account. |
| Design | Apple-style: system font (SF Pro on iPhone), white background, pure black in dark mode, iOS grouped lists, sheets with swipe-to-dismiss, spring animations. Appearance: Automatic, Light or Dark. Mimi the Penguin works out while the app loads and thinks while the AI works. Sheets stay above the iPhone keyboard while you type. |
| PWA | Installable on iPhone, offline app shell |

## One-time setup (all from an iPhone browser)

The Supabase project `loseitandloveit` already exists, and its URL and publishable key are in `src/config.js`. The publishable key is designed to be public: Row Level Security protects the data.

### 1. Database (2 min)
Supabase Dashboard → **SQL Editor** → New query → paste each file in order and **Run** it. Each one is safe to re-run.
1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql): core tables
2. [`supabase/migrations/0002_workouts.sql`](supabase/migrations/0002_workouts.sql): workouts and the exercise eat-back setting
3. [`supabase/migrations/0003_glp1_checkins.sql`](supabase/migrations/0003_glp1_checkins.sql): GLP-1 doses, daily check-ins (mood, water, symptoms) and the GLP-1 plan and water goal on the profile
4. [`supabase/migrations/0004_avatar_mimi_checkins.sql`](supabase/migrations/0004_avatar_mimi_checkins.sql): profile photo and Mimi's check-ins. Until it's run, the photo won't save (the app says so) and check-ins stay hidden.
5. [`supabase/migrations/0005_health_conditions.sql`](supabase/migrations/0005_health_conditions.sql): health conditions (PCOS and others) and weigh-in notes. Until it's run, conditions won't save (the app says so).

### 2. Auth (2 min)
Dashboard → **Authentication → URL Configuration**:
- **Site URL:** `https://ripponmarshall-netizen.github.io/loseitandloveit/`
- **Redirect URLs:** add the same URL.

Create your account in the app. Then, under **Authentication → Sign In / Providers**, turn off **Allow new users to sign up** so strangers can't make accounts.

### 3. AI Edge Function (5 min)
**Updating:** whenever `supabase/functions/ai/index.ts` changes, open the `ai` function → **Code** → paste the new file → **Deploy**. (v0.2.0 changed it: food databases and the lookup tool.)

Dashboard → **Edge Functions** → Deploy a new function → **Via Editor** → name it `ai` → paste [`supabase/functions/ai/index.ts`](supabase/functions/ai/index.ts) → Deploy.
Then, in the function's **Details**, turn **JWT verification OFF** (the toggle name varies a little between dashboard versions). The function checks the user itself, and this avoids issues with the newer JWT signing keys.

Dashboard → **Edge Functions → Secrets**, add:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com |
| `ALLOWED_EMAILS` | the email you signed up with (comma-separate more) |
| `COACH_MODEL` *(optional)* | default `claude-haiku-5-5` |
| `ESTIMATE_MODEL` *(optional)* | default `claude-haiku-5-5` |
| `CHECKIN_MODEL` *(optional)* | default `claude-haiku-5-5` (Mimi's check-ins, always at `low` effort) |
| `AI_DAILY_LIMIT` *(optional)* | default `60` requests/user/day |
| `USDA_API_KEY` *(recommended)* | free from [fdc.nal.usda.gov/api-key-signup](https://fdc.nal.usda.gov/api-key-signup). Without it USDA search uses the shared `DEMO_KEY`, which allows only about 10 searches an hour. |

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
- **Mimi's check-ins** send about 0.5–1k input tokens and get a short reply at `low` effort: roughly US$0.0002–0.0005 each, so 6 a day is about US$0.05–0.09 a month (roughly JMD 7–15; check pricing and the exchange rate yourself). Each counts as one request toward `AI_DAILY_LIMIT`. Redeploy the `ai` function after pulling this change, or check-ins fail quietly.
- The coach and estimates run at `medium` effort. If coaching feels shallow, try `COACH_EFFORT=high` first, then a bigger model (`claude-sonnet-5-5` or `claude-opus-5-5`, set via `COACH_MODEL`).
- Haiku 5.5 has no server-side refusal fallback. If a safety classifier declines, the app shows "try asking another way". Fallback (`fallbacks: "default"`) switches on automatically if you move to an Opus or Sonnet model.
- The system prompt and conversation history use prompt caching. **Settings → AI usage today** shows the tokens you've used.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # node:test unit tests: maths, dates, food search, profile form
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
  lib/checkins.js       when Mimi's check-ins are due, and their small data snapshot (pure, tested)
  lib/viewport.js       keeps sheets above the iPhone keyboard (visualViewport)
  lib/image.js          profile photo crop and resize
  lib/foodSearch.js     food ranking, database result → loggable food, AI reference list
  lib/glp1.js           dose schedule, site rotation, water goal, daily nudges (pure, tested)
  lib/quicklog.js       "log anything" parser and Log sheet suggestions (pure, tested)
  lib/useDay.js         one shared fetch per day for Today and the Log sheet
  data/glp1.js          GLP-1 medicine catalogue, injection sites, mood and symptom scales
  lib/profileForm.js    profile ↔ form conversion and friendly validation
  lib/prefs.js          per-device settings: appearance, food database toggles, check-in interval
  assets/penguins.js    the penguin SVGs (splash, loaders, thinking)
  data/foods.js         built-in Jamaican foods (estimates, edit freely)
  components/           Today, LogSheet, AddFood, MealBreakdown, MimiCheckin, Glp1, Checkin, Progress, Coach, Settings, ProfileForm, Onboarding, Charts, ui
supabase/
  migrations/0001_init.sql   tables + RLS + AI usage functions
  functions/ai/index.ts      Claude API proxy (coach + estimate + check-in + food search), allowlist, daily cap
tests/calc.test.js, food, glp1, quicklog, checkins
```

## Known limits / next steps

1. **Offline logging.** The app shell works offline, but saving needs a connection. Next: an outbox queue in `db.js`.
2. **Food database.** Built-ins are approximate. USDA and Open Food Facts are now searchable (barcodes by typing the number). Next: verify the top 20 built-ins against recipes, and camera barcode scanning (iOS Safari has no BarcodeDetector, so it needs a library).
3. **Reminders when the app is closed.** Mimi's check-ins only run while the app is open. Real phone notifications need Web Push (iOS 16.4+, home-screen app only), a push-subscription table and a Supabase cron job that builds the snapshot server-side. A scheduled weekly summary would use the same plumbing.
4. **Steps.** Exercise and water are logged; steps aren't yet (no HealthKit access from a web app).
5. **Tests.** Add Playwright smoke tests to CI.

Built-in nutrition values and AI estimates are estimates, not medical advice.
