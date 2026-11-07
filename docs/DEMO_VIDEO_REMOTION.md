# Faultline Mumbai film: Remotion production contract

Use [the locked 2:54 shot list](submission/video-shots.md#final-3-minute-story-one-paid-test-then-the-platform-around-it) for exact narration, footage cuts, proof fields, and sound direction. This file tells the editor how to build that film from the **current** repo. It replaces the earlier 2:59.5 plan, which assumed an HCS delivery message that has not been demonstrated.

## Story and render contract

One proven paid CARLA job carries the story: engineer requests a bounded test → CI buyer pays 0.001 HBAR through Hedera x402 → job 002 runs in CARLA with seven accepted 0G decisions → evidence lands on 0G Storage and Galileo → the same episode replays. A separately labelled four-car run shows scenario breadth. A separately labelled outage run shows the required safe stop. The film ends at **2:54**, leaving six seconds under the 0G three-minute limit.

Composition ID `FaultlineMumbai174`; **1920×1080, 30 fps, 5,220 frames** (0–5,219). All transitions live inside scene ranges. Render H.264 MP4 with a captioned submission master and a clean master.

| Scene | Seconds | Frames | Core image |
|---|---:|---:|---|
| `S01_Hook` | 0–11 | 0–329 | Four-car squeeze; clearly labelled separate 0G scenario |
| `S02_Problem` | 11–25 | 330–749 | Road ribbon becomes Faultline's real `/lab` interface |
| `S03_Payment` | 25–47 | 750–1,409 | Studio choice, x402 402/cap, paid job 002 HashScan, one-run permit |
| `S04_DecisionLoop` | 47–75 | 1,410–2,249 | Paid job 002 CARLA footage plus recorded 0G request IDs/actions |
| `S05_Coverage` | 75–96 | 2,250–2,879 | Separate live-0G four-car run and A/B arena |
| `S06_Evidence` | 96–120 | 2,880–3,599 | Decision log → 0G Storage root; Galileo commit/finalize; verifier |
| `S07_Replay` | 120–138 | 3,600–4,139 | Job 002 original and exact CARLA replay, 194/194 ticks |
| `S08_SafeStop` | 138–153 | 4,140–4,589 | Separate 0G-unreachable run, source none, SAFE_HALT |
| `S09_Outcome` | 153–165 | 4,590–4,949 | Studio result/A/B view, engineer-facing takeaway |
| `S10_Close` | 165–174 | 4,950–5,219 | Road motif, Faultline, working demo/repo links |

## Current repo capture map

The latest Studio has real routes and a six-step **Judge mode**. Capture the actual UI; Remotion adds motion around it. The featured paid job's run name in `apps/faultline-studio/src/main.ts` is `paid-de2d56fd2f3cd49fb30c1a7633f9d8c1-1794006602051`.

| Film beat | Capture or source |
|---|---|
| Engineer intent and paid choice | Studio `/lab`, with policy, suite and payment choice visible. The buyer/merchant quote fields come from `packages/hedera/src/buyer.ts` and the paid job evidence. |
| Paid CARLA decisions | Studio `/mission/paid-de2d56fd2f3cd49fb30c1a7633f9d8c1-1794006602051`, which shows the recorded CARLA video, decision timeline, inspector and telemetry. Original chase file: `videos/paid-job-002-view__chase.mp4`. |
| Result and replay | Studio `/results/paid-de2d56fd2f3cd49fb30c1a7633f9d8c1-1794006602051`, then its Replay tab or Mission Control. Exact replay file: `videos/paid-job-002-replay-view__chase.mp4`. |
| Storage and chain proof | Studio `/verify/paid-de2d56fd2f3cd49fb30c1a7633f9d8c1-1794006602051`; [paid job 002 evidence](evidence/faultline-paid-job-002-carla.md). Capture real request IDs, public root, commit/finalize, and verification state. |
| Swarm breadth | `videos/smart-carla-004__stitched.mp4` for the hook; `videos/video-swarm-fog-001__stitched.mp4` for the planner/motion. Label these as separate runs. |
| A/B breadth | `videos/arena-live0g-video-001__r7l-2s3__side_by_side.mp4` and Studio `/research` or its A/B view. The two stacks ran at the same site with their own live 0G calls. |
| Unreachable fallback | `videos/video-swarm-halt-001__stitched.mp4`, a separate refused-connection run. Keep its `source: none` and `SAFE_HALT` labels. |
| App stills if browser capture is unavailable | `docs/evidence/media/studio-v6-*.png`. Animate a still as a still; never pretend it is a live UI interaction. |

`apps/faultline-studio/public/clips/` contains five **scripted, illustrative CARLA** clips. They are not 0G-driven. Do not use them to prove an in-loop 0G call, a paid run, or a replay. The current Studio's Judge mode can guide a screen-capture pass, but the final film follows the scene order above.

## Visual system

The hero is real CARLA motion. Use a road ribbon that becomes a payment packet, a pulsing square for each recorded 0G checkpoint, and a compact evidence strip that resolves into the actual Storage root. Show the 0G call at a **checkpoint**, never as continuous steering. Bring the same packet back when the paid run's evidence appears; this makes the two networks feel connected without implying a shared chain.

Match the Studio's Space Grotesk / JetBrains Mono and palette (`#0a0a0a`, `#fbfbf6`, `#f3f56c`, `#7cecf5`, `#f5a3ef`). Keep proof values legible at 1080p and captions within a 90 px safe area. Use official sponsor marks as image assets only if supplied; text labels are sufficient. No terminal walls, invented dashboard, stock blockchain animation, fabricated car trajectory, or misleading token icon.

Use one ElevenLabs voice. Export one WAV per scene from the exact lines in the shot list, so edits stay local. ElevenLabs generates the voice outside the renderer; Remotion composes the WAV files. If a timed ElevenLabs transcript is available, use the matching Remotion caption utilities; otherwise create manually timed captions and check them against the audio. A preview without licensed voice can use marked placeholder audio, but the final gate requires the real narration or an explicitly approved replacement. Do not commit API keys.

## Evidence data contract

Put public, non-secret values in `video/assets/evidence.json`. It should include `jobId`, `suiteId`, `simulator`, `policyCommitment`, `paymentAsset`, `paymentAmount`, `paymentTxId`, `paymentHashScanUrl`, `publicRoot`, `commitTx`, `finalizeTx`, `episodeId`, `episodeStatus`, `reportStatus`, `minTtcSeconds`, `collision`, `accepted0gCount`, `replayTicks`, and recorded `{checkpoint, requestId, action, source, videoTimeSeconds}` entries. Validate each against [job 002 evidence](evidence/faultline-paid-job-002-carla.md) and the published log. The data for the separate swarm, A/B, and outage clips must be separately named.

Do **not** put payer private keys, wallet signatures, bearer permits, tenant keys, or raw policy code in the capture package. Shorten an ID for motion graphics only; show the full payment ID and Storage root in proof holds and the video description. The paid report was delivered while the episode itself was **interrupted** on `bad_nonce`; preserve both statuses.

HCS delivery receipt code exists, but no real topic message for paid job 002 is documented. Do not show an HCS receipt, topic sequence, or spending audit as fact. A2A negotiation, FLTTEST HTS settlement, bounded repeat purchases, and Agent Kit have [separate evidence](evidence/faultline-hts-campaign.md); they stay out of this three-minute film. If a distinct Hedera video is allowed, use the optional appendix in the shot list.

## Build and quality gate

1. Create an isolated `video/` Remotion workspace; preserve the Studio and backend build. Install compatible pinned versions of `remotion`, `@remotion/cli`, and any matching `@remotion/*` packages. Check [current Remotion render and media guidance](https://www.remotion.dev/docs/cli/render) before coding. Use tracked footage through `staticFile()` or a reproducible asset-copy step. No external URL should be required for a deterministic render.
2. Implement the ten named scenes as frame-driven components. Build reusable `RoadRibbon`, `DecisionPulse`, `EvidenceStrip`, `TransactionGate`, `ProofHold`, `SafeStopStamp`, and `SubtitleLine` layers. Read values from the validated evidence object, not from display strings. Make the preview render even when optional captures are pending, with visible `CAPTURE REQUIRED` placeholders; fail the **final** render when a required factual asset is absent.
3. Provide `video:preview`, `video:render`, and `video:check` scripts and a `video/README.md` that tells the operator exactly where to place UI captures and ElevenLabs WAVs. The final command must render a local MP4 under three minutes. Keep a contact sheet or stills for the ten scene boundaries.
4. Watch the render once muted and once with sound. Check every source label, subtitle, root/transaction, scene transition, and the 2:54 runtime. The muted cut should still read as **engineer request → Hedera settlement → 0G decision in CARLA → Storage/replay → separate safe-stop proof**. Include direct HashScan, verifier, Galileo, repo and live-demo links in the upload description.

The source plan is a production contract. The Remotion project and final voice/capture assets are work to build; this file does not claim they already exist.
