// Studio build: bundle src/main.ts, copy index.html (API origin added to the CSP) and public/ into dist/.
// FAULTLINE_API_BASE = the agent console origin (e.g. https://host.ts.net); empty = same origin.
import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const here = (p) => new URL(p, import.meta.url).pathname
const base = (process.env.FAULTLINE_API_BASE ?? '').replace(/\/$/, '')
const origin = base ? new URL(base).origin : ''
mkdirSync(here('dist'), { recursive: true })
await build({
  entryPoints: [here('src/main.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: true,
  outfile: here('dist/app.js'), define: { FAULTLINE_API_BASE: JSON.stringify(base) },
})
writeFileSync(here('dist/index.html'), readFileSync(here('index.html'), 'utf8').replaceAll('__API_ORIGIN__', origin))
cpSync(here('public'), here('dist'), { recursive: true })
console.log(`studio built → dist/ (API ${origin || 'same origin'})`)
