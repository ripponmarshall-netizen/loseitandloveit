# Notes for Claude Code sessions

- Owner builds from an iPhone with no local terminal. Keep changes deployable by pushing to `main` (GitHub Actions builds and deploys to Pages). No new build tooling unless needed.
- Plain JS + JSX (no TypeScript in the client). The Edge Function is TypeScript for Deno.
- British English in UI copy. Jamaica-first context: imperial weights by default, Jamaican foods, America/Jamaica timezone.
- Before pushing, run `npm test && npm run build`.
- Data access goes through `src/lib/db.js` only. Store methods live in `src/lib/engine.js` (one implementation, used by both local and cloud mode): add new ones there, clean inputs the way the table's check constraints expect, and call `wrote(table, kind, id)` on every write so cloud mode syncs it. A new table also needs an entry in `TABLES` (engine.js).
- Cloud mode is local-first: screens read the copy on the device and `src/lib/sync.js` pushes writes from an outbox and pulls changes. Never call Supabase tables directly from a screen. Keep `engine.js` and `sync.js` free of browser and Supabase imports, and add tests in `tests/sync.test.js` for any change to them.
- The service worker source is `src/sw.js`; `vite.config.js` writes the built file list into it.
- Schema changes: add a new numbered file in `supabase/migrations/` (never edit 0001 after it has been applied), with RLS policies using `(select auth.uid())`.
- The Anthropic API key must only ever live in Supabase Edge Function secrets. Never call the Claude API from the browser.
- `src/lib/calc.js` holds the maths. Keep it pure and add tests in `tests/calc.test.js` for any change.
