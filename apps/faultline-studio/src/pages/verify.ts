// Verify (/verify[/:id], PRD §4.6): an evidence ladder in three questions, each row with an honest status and the method that checked it.
// Ported from openProof at 0f00ef3; the storage, signature, chain and identity rows now come from GET /api/verify (runner re-check).
import { getJson, stream, verifyRoot, type Decision, type Run, type VerifyResult, type VerifyError } from '../core/api'
import { $, esc, short, extLink, galileoTx, galileoAddr, loading } from '../core/dom'
import { runTabs, runTitle } from '../core/run'
import { statusChip, METHOD, ERC8004, FREE_NOTE, type PS, type Method } from '../core/trust'
import { go } from '../shell'
import { href, FEATURED, type Page } from '../routes'

type S = PS
type M = Method
const ROOT_RE = /^0x[0-9a-f]{64}$/i
const JOB_RE = /^[0-9a-f]{16}$/
// paid test 002's public root (docs/evidence/faultline-paid-job-002-carla.md), so /verify/<FEATURED> still has a root with the runner offline
const FEATURED_ROOT = '0xc1219e48d517edabbea12db2bddf21294bcd5ddb106b00d963d8837cb75f6748'
const WORD: Record<string, string> = { verified: 'Verified', failed: 'Failed', unavailable: 'Unavailable', notchecked: 'Not checked', na: 'Not applicable' }
const ORDER = ['verified', 'failed', 'unavailable', 'notchecked', 'na'] as const

/** "2026-11-06 23:10:05 UTC" from unix seconds or an ISO string. */
const utc = (t?: number | string | null) => {
  if (t == null || t === '') return '-'
  const d = new Date(typeof t === 'number' ? t * 1000 : t)
  return Number.isNaN(d.getTime()) ? esc(t) : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}
const code = (s: unknown) => `<code title="${esc(s)}">${esc(s)}</code>`

type Row = { st: S, title: string, method: M, guarantee: string, artifact: string, how: string, note?: string }
const row = (r: Row) => `<details class="proof" data-st="${r.st}"><summary><b>${esc(r.title)}</b><span class="vf-right"><span class="vf-m">${esc(METHOD[r.method])}</span>${statusChip(r.st)}</span></summary>
  <div class="body"><p>${r.guarantee}</p><p><b>Artifact:</b> ${r.artifact}</p>${r.note ? `<p class="vf-lim"><b>Limitation:</b> ${r.note}</p>` : ''}<p class="muted">${r.how}</p></div></details>`
const group = (t: string, sub: string, rows: Row[], id = '') => `<div class="card"${id ? ` id="${id}"` : ''}><h2 class="sec" style="margin-bottom:4px">${t}</h2><p class="muted" style="margin:0 0 6px">${sub}</p>${rows.map(row).join('')}</div>`

let ctl: AbortController | null = null
let current = ''

async function findRun(id: string, signal: AbortSignal): Promise<{ run: Run | null, online: boolean, gone?: boolean, pending?: boolean }> {
  let runs: Run[] | null = null
  try { runs = await getJson('/api/runs') } catch { /* console offline */ }
  if (signal.aborted) return { run: null, online: !!runs }
  const lc = id.toLowerCase()
  const hit = runs?.find((x) => x.name === id || x.storage?.publicRoot?.toLowerCase() === lc) ?? null
  if (hit || !runs || ROOT_RE.test(id)) return { run: hit, online: !!runs }
  if (JOB_RE.test(id)) {
    try { const j = await getJson(`/api/jobs/${id}`); return { run: j.result ?? null, online: true, pending: !j.result } } catch { return { run: null, online: true, gone: true } }
  }
  try { return { run: await getJson(`/api/run?name=${encodeURIComponent(id)}`), online: true } } catch { return { run: null, online: true } }
}

/** Replayed decision records; stops reading once meta's totalDecisions have arrived (the replay keeps streaming ticks). */
async function decisionsOf(name: string, outer: AbortSignal): Promise<Decision[]> {
  const ds: Decision[] = [], ac = new AbortController(), stop = () => ac.abort()
  outer.addEventListener('abort', stop)
  let total = Infinity
  try {
    await stream('/api/stream', { run: name, mode: 'replay', speed: 8 }, (e) => {
      if (e.t === 'meta' && typeof e.totalDecisions === 'number') total = e.totalDecisions
      if (e.t === 'decision') ds.push(e.d)
      if (ds.length >= total || e.t === 'done') ac.abort()
      if (total === 0) ac.abort()
    }, ac.signal)
  } catch { /* aborted on purpose, or summary only */ }
  outer.removeEventListener('abort', stop)
  return ds
}

function verifyErr(e: VerifyError, offline: boolean): { st: S, text: string } {
  if (offline) return { st: 'unavailable', text: 'The local runner is offline, so nothing was re-checked here.' }
  if (e.status === 400) return { st: 'unavailable', text: `That is not a 0G Storage root: ${esc(e.error)}` }
  if (e.status === 422 && e.rootMismatch) return { st: 'failed', text: `0G Storage refused the download: the Merkle root did not match (${esc(e.error)}).` }
  if (e.status === 422) return { st: 'unavailable', text: `Could not check right now: ${esc(e.error)}. Try again shortly.` }
  if (e.status === 429) return { st: 'unavailable', text: 'Rate limited by the runner. Try again in a minute.' }
  return { st: 'unavailable', text: `Verifier not configured on this runner, or not reachable (${esc(e.error)}).` }
}

function ladder(r: Run | null, ds: Decision[], v: VerifyResult | null, vErr: { st: S, text: string } | null, online: boolean, rootIn: string | null) {
  const free = !!r?.free || (!!r && !r.storage && !r.chain && !r.payment)
  const zg = ds.filter((d) => d.source === '0g'), first = zg[0]
  const st = r?.storage, ch = r?.chain, p = r?.payment, oc = v?.onchain ?? null
  const root = v?.publicRoot ?? st?.publicRoot ?? rootIn
  const metaM: M = 'meta' // a row the runner did not re-check shows run metadata only
  const freeTxt = FREE_NOTE
  const pendSt: S = vErr && online ? 'unavailable' : 'notchecked' // the runner check was tried and could not run, vs not tried
  const notRechecked = vErr?.text ?? (online ? 'Not re-checked.' : 'The local runner is offline; this row shows run metadata only.')
  const unknown = online ? 'no run record for this root' : 'unknown (runner offline)' // no run record and no runner check: never claim "not anchored"

  // --- Who made the decisions?
  const decOk = v ? v.filesOk && v.decisionsWellFormed : null
  const router: Row = zg.length || (v && decOk)
    ? { st: v ? (decOk ? 'verified' : 'failed') : 'notchecked', method: v ? 'runner' : metaM, title: '0G Router private inference',
        guarantee: 'Every attacker move came from the 0G Router on the private tier, which refuses to fall back to another tier.',
        artifact: zg.length ? `${zg.length} of ${ds.length} decisions carry 0G request IDs, first ${code(first.request_id)}` : 'decision file inside the stored public bundle',
        how: v ? (decOk ? 'The runner downloaded the decision file by root; it is well formed and its hash is in the bundle.' : 'The stored decision file did not pass the runner check.') : `Read from the runner's decision log, not checked against 0G Storage. ${notRechecked}` }
    : { st: ds.length ? 'na' : !r ? pendSt : r.decisions ? 'unavailable' : 'na', method: metaM, title: '0G Router private inference',
        guarantee: 'Every attacker move came from the 0G Router on the private tier.', artifact: ds.length ? `${ds.length} decisions, none from 0G` : 'no decision records loaded',
        how: ds.length ? 'This run has no 0G decisions to check.' : 'The decision log could not be replayed from the runner.' }

  const sigs = v?.signatures ?? [], n0g = st?.signatures0g ?? r?.decisions0g ?? zg.length
  const signerOk = v?.quoteSignerMatchesChain ? Object.values(v.quoteSignerMatchesChain).every(Boolean) : false
  const sigSt: S = !v ? (free ? 'na' : pendSt) : !sigs.length ? 'na' : sigs.some((s) => !s.verified) ? 'failed' : v.signaturesAllTrue && signerOk ? 'verified' : 'unavailable'
  const sigRow: Row = { st: sigSt, method: v ? 'runner' : metaM, title: 'Archived provider signatures',
    guarantee: "The provider's signature on each response shows which 0G provider answered.",
    artifact: v ? (sigs.length ? `${sigs.filter((s) => s.verified).length} of ${sigs.length} verified · provider ${short(sigs[0].provider, 8, 6)}` : `0 of ${esc(n0g ?? '-')} archived (legacy run: signatures were not archived at publish time)`)
      : st ? `${esc(st.signaturesArchived ?? 0)} archived of ${esc(st.signatures0g ?? '-')} (metadata)` : free ? freeTxt : 'no archive for this run',
    how: v ? (sigSt === 'failed' ? `Failed: ${esc(sigs.filter((s) => !s.verified).map((s) => `decision ${s.cp}: ${s.reason}`).join('; '))}` : 'The runner recovered each signer from the archived signature and compared it with the provider registered on chain.')
      : free ? 'Free runs are not published, so nothing is archived.' : notRechecked,
    note: v && sigs.length ? (v.contentBinding ? esc(v.contentBinding) : 'A signature shows who answered, not what the prompt said.') : undefined }

  const id = v?.identity
  const idSt: S = !v ? (free ? 'na' : pendSt) : id?.error ? 'unavailable' : id?.evaluatorIsOwner === true ? 'verified' : id?.evaluatorIsOwner === false ? 'failed' : oc?.anchored ? 'unavailable' : 'na'
  const idRow: Row = { st: idSt, method: v ? 'runner' : 'external', title: `Attacker identity (ERC-8004 #${id?.agentId ?? 579})`,
    guarantee: 'The attacker is registered as agent #579 in the ERC-8004 identity registry on 0G Galileo.',
    artifact: id?.owner ? `owner ${code(id.owner)} · ${extLink(galileoAddr(id.registry), 'registry')}` : extLink(galileoAddr(id?.registry ?? ERC8004), 'ERC-8004 registry'),
    how: idSt === 'verified' ? 'The address that anchored this run owns agent #579 (ownerOf read from 0G Galileo).' : idSt === 'failed' ? 'The address that anchored this run does not own agent #579.'
      : id?.error ? `Chain read failed: ${esc(id.error)}` : v ? 'This run was not anchored, so there is no anchoring address to compare.' : `Open the registry to check. ${notRechecked}` }

  // --- Can the evidence be altered?
  const storOk = v ? !!(v.publicRootOk && v.filesOk && v.metricsRecomputedOk && v.aggregatesOk) : null
  const stor: Row = { st: free && !v ? 'na' : v ? (storOk ? 'verified' : 'failed') : vErr && root && online ? vErr.st : root ? 'notchecked' : 'na', method: v ? 'runner' : metaM, title: '0G Storage roots',
    guarantee: 'The public log is stored on 0G Storage; downloading it by root and re-hashing shows it is unchanged.',
    artifact: root ? `public ${code(root)}${st?.sealedRoot ? `<br>sealed ${code(st.sealedRoot)}` : ''}` : free ? freeTxt : 'no root for this run',
    how: v ? (storOk ? 'The runner downloaded the bundle by root (the indexer refuses a Merkle mismatch), re-hashed every file and recomputed the metrics and aggregates.'
      : `Failed: root ${v.publicRootOk ? 'ok' : 'mismatch'}, files ${v.filesOk ? 'ok' : 'changed'}, metrics ${v.metricsRecomputedOk ? 'ok' : 'not reproduced'}, aggregates ${v.aggregatesOk ? 'ok' : 'not reproduced'}.`)
      : root ? `A root in the run record is not proof by itself. ${notRechecked}` : 'Free demo runs are not stored.' }

  const anchored = v ? !!oc?.anchored : r ? !!ch : null // null: no run record and no runner check, so unknown
  const cbf = v ? oc?.committedBeforeFirstCall : ch?.committedBeforeFirstCall
  const commitTx = oc?.commitTx ?? ch?.commitTx
  const commit: Row = { st: anchored === null ? pendSt : !anchored ? 'na' : !v ? pendSt : cbf === true ? 'verified' : cbf === false ? 'failed' : 'unavailable', method: v ? 'runner' : metaM, title: 'Committed before the first decision',
    guarantee: "The scenario was locked on chain before the attacker's first call, so it could not be picked after seeing results.",
    artifact: anchored ? `${commitTx ? extLink(galileoTx(commitTx), short(commitTx, 10, 6)) : '-'} at ${utc(oc?.committedAt ?? ch?.commitBlockTimestamp)} vs first decision ${utc(oc?.firstCall ?? first?.wall_clock_utc)}` : anchored === null ? unknown : free ? freeTxt : 'not anchored',
    how: v && anchored ? 'The runner compared the commit block time on 0G Galileo with the first 0G call.' : anchored || anchored === null ? notRechecked : 'Nothing was committed for this run.' }

  const fin = v ? (oc?.ok === true && oc.publicRootMatches === true ? true : oc?.ok === false || oc?.publicRootMatches === false ? false : null) : ch?.onchainMatches ?? null
  const finRow: Row = { st: anchored === null ? pendSt : !anchored ? 'na' : !v ? pendSt : fin === true ? 'verified' : fin === false ? 'failed' : 'unavailable', method: v ? 'runner' : metaM, title: 'Result finalized after the last decision',
    guarantee: 'The roots and result hash were written on chain after the run and match the stored record.',
    artifact: anchored ? (ch?.finalizeTx ? extLink(galileoTx(ch.finalizeTx), short(ch.finalizeTx, 10, 6)) : oc?.finalizedAt ? `finalized ${utc(oc.finalizedAt)}` : 'not finalized') : anchored === null ? unknown : free ? freeTxt : 'not anchored',
    how: v && anchored ? 'The runner read the registry on 0G Galileo and compared its public root with the downloaded bundle.' : anchored || anchored === null ? notRechecked : 'Nothing was finalized for this run.' }

  const replay: Row = { st: 'notchecked', method: 'external', title: 'Physics replay', guarantee: 'Re-running the recorded trajectory reproduces the reported outcome.',
    artifact: root ? `${extLink(href.verifier(root), 'independent verifier')}` : 'needs a stored root',
    how: v?.replay?.skipped ? esc(v.replay.skipped) : 'Not checked on this page.' }

  // --- Who requested and paid?
  const pay: Row = { st: r && !p ? 'na' : 'notchecked', method: p ? 'external' : metaM, title: 'Hedera x402 payment',
    guarantee: 'Our agent paid for this test on Hedera (quote, spending policy approval, settlement, one-run permit). The tester only signed the request.',
    artifact: p ? `${extLink(p.hashscan, 'HashScan ' + short(p.transaction, 10, 6))} · suite ${code(p.suite)} · payer ${code(p.payer)}` : r ? 'free run: no payment' : unknown,
    how: p ? 'The runner confirmed the settlement on the Hedera mirror node at purchase time; this page does not re-check it. Open HashScan to check it yourself.' : r ? 'Free demo runs are not paid.' : notRechecked }
  const req: Row = { st: r && !r.requestedBy ? 'na' : 'notchecked', method: metaM, title: 'Signed test request',
    guarantee: 'A wallet signed a readable test request (EIP-191); the runner checked it before queuing. A signature is not a payment.',
    artifact: r?.requestedBy ? code(r.requestedBy) : r ? 'not recorded for this run' : unknown, how: r?.requestedBy ? 'The runner checked the signature when the run was requested; this page does not re-check it.' : r ? 'Guest runs carry no signature.' : notRechecked }

  return { g1: [router, sigRow, idRow], g2: [stor, commit, finRow, replay], g3: [pay, req], root, free }
}

function timeline(r: Run | null, ds: Decision[], v: VerifyResult | null, online: boolean) {
  const zg = ds.filter((d) => d.source === '0g'), oc = v?.onchain, ch = r?.chain
  const committed = oc?.committedAt ?? ch?.commitBlockTimestamp ?? null
  const firstT = zg[0]?.wall_clock_utc ?? oc?.firstCall ?? null, lastT = zg.at(-1)?.wall_clock_utc ?? null
  const fin = oc?.finalizedAt ?? null
  const none = r || v ? null : online ? 'no run record for this root' : 'unknown (runner offline)' // nothing to read: unknown, not "not anchored"
  const li = (ok: boolean, t: string, s: string) => `<li class="${ok ? 'ok' : 'na'}"><b>${t}</b><span>${s}</span></li>`
  return `<div class="head"><h2 class="sec" style="margin:0">Timeline${r ? `: ${esc(runTitle(r.name))}` : ''}</h2></div><ol class="vtl">
    ${li(!!committed, 'Scenario committed', committed ? utc(committed) : none ?? (r?.free ? 'not anchored (free run)' : 'not anchored'))}
    ${li(!!firstT, 'First 0G decision', firstT ? utc(firstT) : none ?? '-')}
    ${li(!!lastT, 'Last 0G decision', lastT ? utc(lastT) : none ?? '-')}
    ${li(!!(fin || ch?.finalizeTx), 'Result finalized', fin ? utc(fin) : ch?.finalizeTx ? extLink(galileoTx(ch.finalizeTx), short(ch.finalizeTx, 10, 6)) : none ?? 'not finalized')}</ol>`
}

function summary(all: Row[], root: string | null, online: boolean) {
  const n: Record<string, number> = {}
  for (const x of all) n[x.st] = (n[x.st] ?? 0) + 1
  const bad = (n.failed ?? 0) + (n.unavailable ?? 0)
  const head = n.failed ? `${n.failed} check${n.failed > 1 ? 's' : ''} failed` : n.unavailable ? `${n.unavailable} check${n.unavailable > 1 ? 's' : ''} could not run` : n.verified ? 'Every check that ran passed' : 'Nothing was re-checked'
  return `<div class="vf-sum"><div><p class="kicker">Overall</p><h2 class="sec vf-head ${n.failed ? 'bad' : bad ? 'warn' : n.verified ? 'good' : ''}" style="margin:0">${head}</h2>
    <ul class="vf-counts">${ORDER.filter((s) => n[s]).map((s) => `<li>${statusChip(s as S)} <span>${n[s]}</span><span class="sr"> ${WORD[s]}</span></li>`).join('')}</ul>
    ${online ? '' : '<p class="muted" style="margin:8px 0 0">The local runner is offline. Rows show metadata only; the independent verifier works without it.</p>'}</div>
    <div class="row">${root ? `<a class="btn y" href="${href.verifier(root)}">Verify independently</a>` : ''}<button class="btn" data-recheck>Check again</button></div></div>`
}

async function check(id: string) {
  ctl?.abort(); ctl = new AbortController()
  const { signal } = ctl
  current = id
  $<HTMLInputElement>('vf-in').value = id
  $('vf-err').textContent = ''
  const tabsEl = $('vf-tabs'), body = $('vf-body')
  tabsEl.innerHTML = ''
  body.innerHTML = `<div class="card">${loading('Checking the evidence…', 'solving')}</div>`
  const { run: r, online, gone, pending } = await findRun(id, signal)
  if (signal.aborted) return
  if (!ROOT_RE.test(id)) tabsEl.innerHTML = runTabs(r?.name ?? id, 'verify')
  else if (r) tabsEl.innerHTML = runTabs(r.name, 'verify')
  const root = ROOT_RE.test(id) ? id : r?.storage?.publicRoot ?? (id === FEATURED ? FEATURED_ROOT : null)
  if (!r && !root) {
    body.innerHTML = `<div class="card">${gone ? `This live job is no longer on the runner. <a href="${href.library()}">Explore recorded runs</a>.`
      : pending ? `This run has not finished yet. Evidence appears after it publishes. <a href="${href.mission(id)}">Watch the run</a>.`
      : `No finished run matches ${code(id)}${online ? '' : ' (the local runner is offline)'}. Try <a href="${href.verify(FEATURED)}">paid test 002</a> or paste a 0G Storage public root.`}</div>`
    return
  }
  const [ds, vr] = await Promise.all([r && online ? decisionsOf(r.name, signal) : Promise.resolve([] as Decision[]), root && online && !r?.free ? verifyRoot(root) : Promise.resolve(null)])
  if (signal.aborted) return
  const v = vr && !('status' in vr && typeof vr.status === 'number') ? (vr as VerifyResult) : null
  const vErr = vr && !v ? verifyErr(vr as VerifyError, !online) : root && !online ? verifyErr({ status: 503, error: 'offline' }, true) : null
  const L = ladder(r, ds, v, vErr, online, root)
  const all = [...L.g1, ...L.g2, ...L.g3]
  body.innerHTML = `<div class="card">${summary(all, L.root, online)}</div>
    <div class="card" id="vf-timeline">${timeline(r, ds, v, online)}</div>
    <div id="vf-ladder" class="grid">${group('Who made the decisions?', '0G Router (inference)', L.g1)}${group('Can the evidence be altered?', '0G Storage and 0G Galileo (storage and chain)', L.g2)}${group('Who requested and paid?', 'Hedera', L.g3, 'vf-payment')}</div>
    <div class="card note-a2"><b>Limitation.</b> Provider signatures show which 0G provider returned each response. They do not prove the physics, and under end-to-end encryption they do not bind the plaintext prompt. The physics is checked separately from the recorded trajectory.</div>
    <p class="vf-prov">${r ? 'Recorded' : 'Root only'} · ${v ? `checked by local runner at ${utc(v.checked_at)}` : online ? 'run metadata from local runner' : 'metadata only'}${v?.onchain?.commitTx ? ` · ${extLink(galileoTx(v.onchain.commitTx), 'on-chain commit')}` : ''}</p>`
  body.querySelectorAll('[data-recheck]').forEach((b) => b.addEventListener('click', () => check(current)))
}

function submit() {
  const v = $<HTMLInputElement>('vf-in').value.trim()
  if (/^0x/i.test(v) && !ROOT_RE.test(v)) { $('vf-err').textContent = 'A 0G Storage root is 0x followed by 64 hex characters.'; return }
  go(href.verify(v || FEATURED))
}

export const page = {
  id: 'verify' as Page,
  title: 'Verify',
  css: `
    #v-verify .vf-in { flex: 1; min-width: 0; width: 100%; min-height: 48px; border-radius: 999px; border: 1px solid #444; background: #111; color: var(--paper); padding: 0 16px; font: 14px var(--mono) }
    #v-verify .vf-form { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px } #v-verify .vf-form .vf-in { flex: 1 1 240px }
    #v-verify .vf-err { color: var(--pink); font: 13px var(--mono); min-height: 1em; margin: 8px 0 0 }
    #v-verify .vtl { list-style: none; padding: 0; margin: 12px 0 0; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px }
    #v-verify .vtl li { border-top: 3px solid #ccc; padding-top: 8px } #v-verify .vtl li.ok { border-color: #2f9e44 } #v-verify .vtl b { display: block }
    #v-verify .vtl span { font: 12px var(--mono); color: var(--muted); overflow-wrap: anywhere }
    #v-verify .proof { border: 1px solid #ddd; border-radius: 14px; margin-top: 10px; background: #fff }
    #v-verify .proof summary { cursor: pointer; padding: 12px 14px; min-height: 44px; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap }
    #v-verify .proof .body { padding: 0 14px 14px; font-size: 15px; overflow-wrap: anywhere } #v-verify .proof code { font-size: 12px; overflow-wrap: anywhere }
    #v-verify .vf-right { display: inline-flex; gap: 10px; align-items: center; flex-wrap: wrap }
    #v-verify .vf-m { font: 12px var(--mono); color: var(--muted) }
    #v-verify .vf-lim { background: #f1f1ea; border-radius: 10px; padding: 8px 10px }
    #v-verify .vf-sum { display: flex; justify-content: space-between; gap: 16px; align-items: center; flex-wrap: wrap }
    #v-verify .vf-head.good { color: #2b8a3e } #v-verify .vf-head.warn { color: #a06200 } #v-verify .vf-head.bad { color: #c92a2a }
    #v-verify .vf-counts { list-style: none; padding: 0; margin: 10px 0 0; display: flex; gap: 12px; flex-wrap: wrap } #v-verify .vf-counts li { display: inline-flex; gap: 6px; align-items: center; font: 600 14px var(--mono) }
    #v-verify .vf-prov { font: 12px var(--mono); margin: 0; color: #9a9a94 } #v-verify .vf-prov a { color: var(--paper) }
    #v-verify .runtabs { display: flex; gap: 8px; flex-wrap: wrap }
    #v-verify .runtabs a { min-height: 44px; display: inline-flex; align-items: center; padding: 0 18px; border-radius: 999px; border: 1.5px solid #fbfbf655; color: var(--paper); text-decoration: none; font-weight: 600 }
    #v-verify .runtabs a.on { background: var(--paper); color: var(--ink) } #v-verify .note-a2 { font-size: 15px }
    #v-verify .grid { display: grid; gap: 16px }
    @media (max-width: 720px) { #v-verify .vtl { grid-template-columns: 1fr 1fr } #v-verify .vf-sum .row { width: 100% } }
  `,
  mount(root: HTMLElement) {
    root.setAttribute('aria-labelledby', 'vf-title')
    root.innerHTML = `<div class="grid">
      <div id="vf-tabs"></div>
      <div class="card k">
        <p class="kicker">Verify</p>
        <h1 class="sec" id="vf-title" style="color:var(--paper)">Check the evidence yourself</h1>
        <p class="lede">Pick a run or paste a 0G Storage public root. Each check says what it guarantees, shows the exact artifact, names who checked it, and has an honest status.</p>
        <form class="vf-form" id="vf-form"><label class="sr" for="vf-in">Run name or public root</label><input id="vf-in" class="vf-in" placeholder="run name or 0x public root" autocomplete="off" spellcheck="false"><button class="btn y" type="submit">Check</button></form>
        <p class="vf-err" id="vf-err" role="alert"></p>
      </div>
      <div id="vf-body" class="grid" aria-live="polite"></div>
    </div>`
    $('vf-form').addEventListener('submit', (e) => { e.preventDefault(); submit() })
  },
  open(id: string | null) { check(id ?? FEATURED) },
  leave() { ctl?.abort(); ctl = null },
}
