# Faultline: submission checklist (ETHGlobal Mumbai)

Repo: https://github.com/Soni-Shivam/Pivot_HTE (`main`). Videos: [`videos/`](../../videos/README.md).
Read first: [`WEB3.md`](WEB3.md) (every Web3 piece and why), [`INTELLIGENCE.md`](INTELLIGENCE.md) (what the LLM
decides vs what code decides), [`../INTEGRATE_YOUR_STACK.md`](../INTEGRATE_YOUR_STACK.md) (how an AV-stack owner plugs in).

## Deployed contracts (0G Galileo, chain 16602)
| Contract | Address |
|---|---|
| EpisodeRegistry v1 | `0x23edb2e37F9a2a2b1DAaF0514b58E278f2FFF46A` |
| EpisodeRegistry v2 (commit-before / finalize-after, config hash, nonce binding) | `0xeE2260cE4835059F0e0f1FB9C9948Ca5a7d4b5A4` |
| AgentMemoryRegistry (versioned safety memory, ERC-8004-owner-only anchoring) | `0x7a8676D267f1aa17d6B55cF5BfcD2A9509b963e3` |
| ERC-8004 adversary identity | agentId 579 on `0x8004A818BFB912233c491871b3d84c89A494BD9e` |

## Headline evidence (full tables in `docs/evidence/`)
| What | Evidence |
|---|---|
| Anchored CARLA lead-brake episode, signatures archived 8/8 | demo-003: public root `0x69a532d1bb89d02b43111558a338bbe0a42549f5d1c5d28302226d9a0c626a89`, commit `0x7c905fca…0957` before the first 0G call, finalize `0x97b65582…fbf3` (`faultline-matrix.md`) |
| Paid stress test: Hedera x402 → CARLA → 0G → Galileo | job 002: Hedera tx `0.0.9185802@1794006563.434123686`, public root `0xc1219e48d517edabbea12db2bddf21294bcd5ddb106b00d963d8837cb75f6748`, signatures 7/7, replay exact (`faultline-paid-job-002-carla.md`) |
| Safe stop when 0G is unreachable | halt-001, cutin-halt-001 (`faultline-matrix.md`) |
| 4-car swarm on one shared 0G plan | swarm-carla-008 / -010, signatures 10/10 each (`faultline-swarm.md`); campaign elites carla-05..08, 40/40 (`faultline-campaign.md`) |
| Research loop: hunt, minimize, explain, audit, fix | `faultline-hunt.md`, `faultline-research.md` (47/47 signatures) |
| Version-aware memory v1.0 → v1.1 | 135 paired tests, 0 regressions; anchors on AgentMemoryRegistry; 8 Arkiv claims (`faultline-memory.md`) |
| A/B arena: same attack, two AV stacks | 4 sites, PDM-Lite vs cautious IDM (`faultline-stack-bridge.md`) |
| 0G-designed CARLA crash hunt (night, rain, fog) | 25 experiments, no valid crash, closest 3.55 m (`faultline-carla-crash.md`) |

## Prize requirements
**0G Physical AI:** 0G call in the decision loop ✓ · episode log on 0G Storage with a request id per decision ✓ ·
replayable simulation ✓ (`faultline replay`) · safe stop without faking ✓ · contract addresses ✓ · public repo +
README ✓ · **demo video (< 3 min) — TODO** · **live demo link — TODO** (verifier page is static and https-ready:
`npm run fweb:build`, host `apps/faultline-web/dist`) · team names + Telegram/X — TODO.
**Hedera x402:** x402 endpoint settling on testnet ✓ · agent pays with no human ✓ · tx id in README ✓
(`packages/hedera/README.md`) · spending cap ✓ · **demo video ≤ 5 min showing HashScan — TODO**.
**Arkiv:** writes + reads on Rabdi ✓ · `arkiv/{schema,friction,reach,why-arkiv,how-you-use-arkiv}.md` ✓ · writer
wallet + query in README — check · page reads Arkiv ✓ (`apps/memory-web`).

## Honest limits (keep in the pitch)
CARLA motion for the adversary is kinematic; the ego is CARLA physics. Content binding of the signed answer to our
logged text is not checkable under the Router's end-to-end encryption (audit A2). The LLM does not beat bisection
on raw boundary search; its value is goal-to-experiment translation, strategy and reports, with deterministic audit.
CCS is a criticality score, not an accident probability.
