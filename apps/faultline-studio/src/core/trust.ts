// Trust rail (which network proved what) and the five honest proof statuses. Fail-closed: a dot is green only when a check passed
// (a verifyRoot() result); run metadata alone is 'recorded, not checked here'.
import type { Decision, Run, VerifyResult } from './api'
import { esc, galileoAddr, galileoTx, short } from './dom'

export type Trust = { decisions0g?: number | null; decisions?: number | null; requestId?: string | null; provider?: string | null
  sigsVerified?: number | null; sigsTotal?: number | null; sigsArchived?: number | null; publicRoot?: string | null; sealedRoot?: string | null
  commitTx?: string | null; finalizeTx?: string | null; onchainMatches?: boolean | null; commitBeforeFirst?: boolean | null; registry?: string | null
  agentId?: number | null; hedera?: { transaction: string; hashscan: string } | null; arkiv?: string | null; free?: boolean; note?: string
  /** results of an independent check (GET /api/verify); null/undefined = not checked here */
  checked?: { sigs: boolean | null, storage: boolean | null, chain: boolean | null } | null }
export const ERC8004 = '0x8004A818BFB912233c491871b3d84c89A494BD9e'
export const FREE_NOTE = 'Free run: not paid, not anchored.'
/** Legend for railHtml. */
export const RAIL_LEGEND = 'A green dot means a check passed. Grey means recorded, not checked here.'

/** v: a GET /api/verify result for this run's public root; only it can turn a dot green. */
export function trustFromRun(r: Run | null, ds: Decision[] = [], free = false, v?: VerifyResult | null): Trust {
  const zg = ds.filter((d) => d.source === '0g'), first = zg[0]
  const ch = r?.chain, st = r?.storage
  const cbf = ch?.committedBeforeFirstCall ?? (ch?.commitBlockTimestamp && first?.wall_clock_utc ? ch.commitBlockTimestamp * 1000 < Date.parse(first.wall_clock_utc) : null)
  return { decisions0g: zg.length || r?.decisions0g, decisions: ds.length || r?.decisions, requestId: first?.request_id, provider: first?.provider,
    sigsVerified: st?.signaturesVerified ?? null, sigsTotal: st?.signatures0g ?? null, sigsArchived: st?.signaturesArchived ?? null,
    publicRoot: st?.publicRoot, sealedRoot: st?.sealedRoot, commitTx: ch?.commitTx, finalizeTx: ch?.finalizeTx, onchainMatches: ch?.onchainMatches,
    commitBeforeFirst: cbf, registry: ch?.registry, agentId: r?.agentId ?? null, hedera: r?.payment ? { transaction: r.payment.transaction, hashscan: r.payment.hashscan } : null,
    arkiv: r?.arkivEntity ?? null, free: free || !!r?.free,
    checked: v && st?.publicRoot && v.publicRoot === st.publicRoot ? {
      sigs: v.signaturesAllTrue ?? null,
      storage: v.publicRootOk === false || v.filesOk === false ? false : v.publicRootOk && v.filesOk ? true : null,
      chain: !v.onchain?.anchored ? null : v.onchain.ok === false || v.onchain.committedBeforeFirstCall === false ? false : v.onchain.ok && v.onchain.committedBeforeFirstCall ? true : null,
    } : null }
}

export function railHtml(t: Trust) {
  // meta: the run record says so, but nothing was re-checked in this view (grey, never green)
  type S = 'up' | 'part' | 'down' | 'meta' | 'id' | ''
  const WORD: Record<S, string> = { up: 'check passed', part: 'partly checked', down: 'check failed', meta: 'recorded, not checked here', id: 'identity information', '': 'not recorded' }
  const card = (s: S, net: string, body: string, proves: string, url?: string | null) => {
    const inner = `<span class="n"><i class="dot ${s}" aria-hidden="true"></i>${net}<span class="sr">: ${WORD[s]}</span>${url ? ' ↗' : ''}</span><span class="s">${body}</span>`
    return url ? `<a class="tp" href="${esc(url)}" target="_blank" rel="noopener" data-tip="${esc(proves)}">${inner}</a>` : `<span class="tp" tabindex="0" data-tip="${esc(proves)}">${inner}</span>`
  }
  const c = t.checked, REC = 'recorded, not checked here'
  const yn = (x: boolean | null | undefined) => (x === true ? 'yes' : x === false ? 'no' : 'unknown')
  // a recorded false is shown as failed (fail-closed); a recorded true stays grey until a check passes
  const st = (chk: boolean | null | undefined, recordedBad: boolean, has: boolean): S => chk === false || recordedBad ? 'down' : chk === true ? 'up' : has ? 'meta' : ''
  const has0g = (t.decisions0g ?? 0) > 0 && !!t.requestId
  const zgS = st(c?.sigs, false, has0g)
  const chainBad = t.onchainMatches === false || t.commitBeforeFirst === false
  return [
    card(zgS, '0G Private Computer', has0g ? `${t.decisions0g} of ${t.decisions ?? '-'} moves came from 0G · ${zgS === 'up' ? 'signatures checked' : zgS === 'down' ? 'signature check failed' : `signatures ${REC}`}` : esc(t.note ?? 'No 0G decisions yet'),
      'Shows each attacker move was answered by a model running in 0G’s private (TEE) computer, with a request ID and a signed reply.'),
    card(st(c?.storage, false, !!t.publicRoot), '0G Storage', t.publicRoot ? `Root ${short(t.publicRoot, 6, 4)} · ${c?.storage === true ? 're-downloaded and matched' : c?.storage === false ? 'check failed' : REC}` : t.free ? FREE_NOTE : 'Not stored',
      'The full decision log and results were uploaded; anyone can re-download them by this root and re-check the hash.'),
    card(st(c?.chain, chainBad, !!t.commitTx), '0G Galileo chain',
      t.commitTx ? `Committed before the first move: ${yn(t.commitBeforeFirst)} · result matches: ${yn(t.onchainMatches)} · ${c?.chain === true ? 'checked' : c?.chain === false || chainBad ? 'check failed' : REC}` : t.free ? FREE_NOTE : 'Not anchored',
      'The test setup was locked on-chain before the attacker’s first move, and the final result hash matches what was stored.', t.commitTx ? galileoTx(t.commitTx) : null),
    card('id', 'ERC-8004 identity', `Attacker agent #${t.agentId ?? 579} (identity on 0G Galileo)`,
      'The attacker’s registered identity in the ERC-8004 agent registry on 0G Galileo. Identity information, not a per-run proof.', galileoAddr(ERC8004)),
    card(t.hedera ? 'meta' : '', 'Hedera payment', t.hedera ? `Paid · ${short(t.hedera.transaction, 10, 6)} · ${REC}` : t.free ? 'Free run, no payment' : 'No payment',
      'Our agent paid for this test with an x402 micropayment on Hedera, with no human approval step. Open HashScan to check it.', t.hedera?.hashscan),
    card(t.arkiv ? 'meta' : '', 'Arkiv', t.arkiv ? `Public claim ${short(t.arkiv, 6, 4)} · ${REC}` : 'No public claim for this run',
      'A queryable public claim about the result was published on Arkiv.'),
  ].join('')
}

// ---------- proof statuses: icon + text, never colour alone ----------
export type PS = 'verified' | 'failed' | 'unavailable' | 'notchecked' | 'na'
export const PS_WORD: Record<PS, string> = { verified: 'Verified', failed: 'Failed', unavailable: 'Unavailable', notchecked: 'Not checked', na: 'Not applicable' }
const PS_ICON: Record<PS, string> = { verified: '✓', failed: '✗', unavailable: '?', notchecked: '○', na: '–' }
export const PS_LIST = Object.keys(PS_WORD) as PS[]
export const statusChip = (ps: PS) => `<span class="st ${ps}"><span aria-hidden="true">${PS_ICON[ps]}</span> ${PS_WORD[ps]}</span>`

/** Who did the check behind a status. */
export const METHOD = { browser: 'Checked in this browser', runner: 'Checked by local runner', meta: 'Metadata only', external: 'Open external explorer' } as const
export type Method = keyof typeof METHOD
