# Deploy Faultline Studio to Vercel

Studio is a static page (`apps/faultline-studio/dist/`). It talks to the agent console on the build machine through
Tailscale Funnel. With the console offline, the page still shows the recorded evidence (Featured, recorded A/B
table, judge guide) and labels it "Console offline".

## Build locally (same command Vercel runs)
```bash
. ~/.nvm/nvm.sh && npm ci --ignore-scripts
FAULTLINE_API_BASE=https://sedrica-w.tail1b988f.ts.net npm run studio:build   # → apps/faultline-studio/dist
npm run studio:test    # e2e journeys (PLAYWRIGHT_MODULE, CHROMIUM_PATH: see the header of test/e2e.mjs)
```
`FAULTLINE_API_BASE` is compiled into `app.js` and its origin is added to the page CSP (`connect-src`, `media-src`).
Empty = same origin (the console serving the page itself, `npm run studio`). No Python, CARLA or `.env` is needed to build.

## Vercel project (CLI)
`apps/faultline-studio/vercel.json` sets: install `cd ../.. && npm ci --ignore-scripts`, build
`cd ../.. && npm run studio:build`, output `dist`, framework none.

```bash
export VERCEL_TOKEN=...            # from the user; never commit it
cd apps/faultline-studio
npx vercel@39.1.1 link --yes --token "$VERCEL_TOKEN" --project faultline-studio
npx vercel@39.1.1 env add FAULTLINE_API_BASE production --token "$VERCEL_TOKEN"   # value: https://sedrica-w.tail1b988f.ts.net
npx vercel@39.1.1 env add FAULTLINE_API_BASE preview --token "$VERCEL_TOKEN"
npx vercel@39.1.1 deploy --token "$VERCEL_TOKEN"            # preview URL
npx vercel@39.1.1 deploy --prod --token "$VERCEL_TOKEN"     # production, after checking the preview
```
Dashboard alternative: import the repo, Root Directory `apps/faultline-studio`, keep "Include files outside the root
directory" on, add the env var `FAULTLINE_API_BASE`, deploy.

## The console must allow the Vercel origin
The page is on `*.vercel.app` and the API on the Funnel host, so every call is cross-origin:
- The console must answer CORS for the deployed origin (exact origin, not `*`), including the `OPTIONS` preflight
  for POSTs (`content-type: application/json`, `x-faultline-console: 1`).
- Its Host-header check must accept `sedrica-w.tail1b988f.ts.net`.
- `/media/<path>` must serve the clips the Featured screen asks for: `videos/<file>.mp4` (repo `videos/`), with range
  support. If a clip fails, the page falls back to `https://raw.githubusercontent.com/Soni-Shivam/Pivot_HTE/main/videos/<file>`.

## Check after deploy
Open the URL in a private window: the judge guide opens; header dots show Hedera / 0G / CARLA from `/api/health`;
Featured videos play; Order → Replay reaches "Report ✓" with the trust rail filled.
