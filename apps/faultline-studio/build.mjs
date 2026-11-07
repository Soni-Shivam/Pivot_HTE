// Studio build: bundle src/main.ts, copy index.html (API origin added to the CSP) and public/ into the output dir,
// then build the independent verifier (apps/faultline-web) and Safety Memory (apps/memory-web) into <out>/verifier and <out>/memory.
// FAULTLINE_API_BASE = the agent console origin (e.g. https://host.ts.net); empty = same origin.
// STUDIO_OUT overrides the output dir (default dist/); SKIP_STATIC_APPS=1 skips the two static apps.
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const here = (p) => new URL(p, import.meta.url).pathname
const out = resolve(process.env.STUDIO_OUT || here('dist'))
const base = (process.env.FAULTLINE_API_BASE ?? '').replace(/\/$/, '')
const origin = base ? new URL(base).origin : ''
mkdirSync(out, { recursive: true })
await build({
  entryPoints: [here('src/main.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: true,
  outfile: `${out}/app.js`, define: { FAULTLINE_API_BASE: JSON.stringify(base) },
})
writeFileSync(`${out}/index.html`, readFileSync(here('index.html'), 'utf8').replaceAll('__API_ORIGIN__', origin))
cpSync(here('public'), out, { recursive: true })

if (process.env.SKIP_STATIC_APPS !== '1') {
  const root = here('../..')
  // the same esbuild commands as package.json fweb:build / mweb:build
  for (const [script, app, dest] of [['fweb:build', 'faultline-web', 'verifier'], ['mweb:build', 'memory-web', 'memory']]) {
    execSync(`npm run -s ${script}`, { cwd: root, stdio: 'inherit' })
    rmSync(`${out}/${dest}`, { recursive: true, force: true })
    cpSync(`${root}apps/${app}/dist`, `${out}/${dest}`, { recursive: true })
  }
}
console.log(`studio built → ${out} (API ${origin || 'same origin'}${process.env.SKIP_STATIC_APPS === '1' ? ', static apps skipped' : ', with /verifier and /memory'})`)
