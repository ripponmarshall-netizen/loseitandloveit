# Notes for Claude Code sessions

- Owner builds from an iPhone with no local terminal. Keep changes deployable by pushing to `main` (GitHub Actions builds and deploys to Pages). No new build tooling unless needed.
- Plain JS + JSX (no TypeScript in the client). The Edge Function is TypeScript for Deno.
- British English in UI copy. Jamaica-first context: imperial weights by default, Jamaican foods, America/Jamaica timezone.
- Before pushing, run `npm test && npm run build`.
- Data access goes through `src/lib/db.js` only. Any new store method must be implemented for **both** `createCloudStore` and `createLocalStore`.
- Schema changes: add a new numbered file in `supabase/migrations/` (never edit 0001 after it has been applied), with RLS policies using `(select auth.uid())`.
- The Anthropic API key must only ever live in Supabase Edge Function secrets. Never call the Claude API from the browser.
- `src/lib/calc.js` holds the maths. Keep it pure and add tests in `tests/calc.test.js` for any change.
