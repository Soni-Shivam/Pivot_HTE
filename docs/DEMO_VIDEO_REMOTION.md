# Faultline Mumbai film: **The Road Test Nobody Wrote**

Production storyboard for a **single 2:59.5 submission film**, edited in Remotion with ElevenLabs narration. This is a film, not a screen recording with a voice-over. The camera follows one paid scenario from the engineer's request into CARLA, through 0G decisions, and out as replayable evidence and a Hedera delivery receipt.

**Core sentence:** Faultline generates bounded physical-AI stress scenarios; 0G chooses the adversary's actions and preserves the evidence; Hedera lets a CI client buy one run and records what was delivered.

**Visual idea:** Begin at the most tense CARLA frame. Time fractures into three transparent car positions, then rewinds along the adversary's path. The path becomes a luminous road ribbon that carries us through the real purchase, 0G's decision loop, the replay, and the HCS receipt. This one ribbon keeps the film coherent while the environments change. It is an explanatory visual, not a claim that many scenarios were executed.

## Edit contract

- Composition ID `FaultlineMumbai180`; **1920×1080, 30 fps, 5,385 frames**. Last frame is 5,384. Render to H.264 MP4, 16:9, with subtitles burned in and a clean subtitle-free master.
- Each scene owns the exact frames in the table. Place transitions **inside** those ranges; do not add transition frames between scenes. Final runtime is **179.5 seconds**, strictly under the 0G limit.
- Narration: one ElevenLabs voice, conversational and confident, about 140 words/minute. Generate one WAV per scene so timing changes do not ripple through the film. Never time-stretch speech. Allow CARLA sound and music to carry the pauses.
- Music: 120 BPM instrumental pulse, restrained under speech; engine, tire, UI click, packet pulse and receipt-stamp effects are separate tracks. Beat drops at **1:07** when we enter 0G. Cut music to near silence for the safe-stop beat.
- Palette for this film: asphalt `#080B10`, 0G decision lime `#C9FF54`, Hedera transaction violet `#A783FF`, risk orange `#FF6547`, evidence white `#EAF0F4`. These colors identify roles in *our* film; use the official sponsor marks as supplied assets, not retyped substitutes.
- Type: large editorial headings (Space Grotesk or another licensed geometric sans), technical IDs in IBM Plex Mono. Maximum two lines of copy at once. Safe area 96 px. No full-screen terminal text and no stock blockchain hex rain.
- 0G's real product labels appear as three distinct stages: **PRIVATE COMPUTER / STORAGE / CHAIN**, reflecting its official [product page](https://0g.ai/product). CARLA owns physics; 0G makes decisions at checkpoints. Hedera's x402 purchase precedes the run, and HCS delivery follows it.

## Locked timeline and voice

| Scene | Time / frames | Beat | Exact ElevenLabs voice line |
| --- | --- | --- | --- |
| `S01_ColdOpen` | 0:00–0:12 / 0–359 | Tense CARLA cut-in, freeze at the closest approach | “Your policy passed the tests you wrote. What about the road test you never thought to write?” |
| `S02_Rewind` | 0:12–0:28 / 360–839 | Rewind to the problem and reveal Faultline | “Scripted suites replay situations people anticipated. Faultline generates bounded adversarial scenarios to expose the situations they missed.” |
| `S03_Engineer` | 0:28–0:46 / 840–1379 | Real product use: policy commitment, suite, limits, budget | “A safety engineer chooses the policy build, the cut-in suite, and a strict one-run budget. The driving policy stays local.” |
| `S04_HederaPay` | 0:46–1:07 / 1380–2009 | CI client buys the bounded run through x402 | “The CI client receives a price through Hedera x402. It checks its merchant and spending limits, pays without a checkout, and receives one job permit.” |
| `S05_0GInside` | 1:07–1:31 / 2010–2729 | Hero animation: enter 0G Private Computer | “Now the scenario is being written. At a checkpoint, 0G Private Computer sees the current state and chooses a legal adversary move. The answer carries a request ID.” |
| `S06_CarlaRun` | 1:31–1:57 / 2730–3509 | Real CARLA, two or three recorded 0G decisions, ego reaction | “CARLA advances the cars. The adversary cuts in; the ego brakes. A new observation goes back to 0G. The model chooses the next move while local code handles every physics tick.” |
| `S07_SafeStop` | 1:57–2:11 / 3510–3929 | Separate resilience capture: Router unavailable, safe halt | “When 0G cannot answer, the adversary safe-stops. Faultline never invents a replacement decision.” |
| `S08_ReplayEvidence` | 2:11–2:33 / 3930–4589 | Outcome, replay, 0G Storage and Galileo verification | “The engineer gets the critical moment, safety metrics, and a replay. The episode log is stored on 0G Storage, with its root checked against the 0G Chain record.” |
| `S09_HCSReceipt` | 2:33–2:53 / 4590–5189 | Payment and evidence converge in a real HCS receipt | “Hedera's delivery receipt links the payment, policy commitment, suite version, job result, and exact 0G evidence root. HashScan shows what was purchased and delivered.” |
| `S10_EndCard` | 2:53–2:59.5 / 5190–5384 | Return to road, Faultline mark and live demo URL | “Faultline. Generate the road test you didn't know to write.” |

## Scene direction: what the editor actually builds

### S01 — Stop the scroll

Use the **real paid CARLA run's** most legible near-miss, cropped so the ego and adversary fill the center 70% of frame. Play at normal speed for 2 seconds; ramp to 40% speed as the gap closes. Freeze before contact or at minimum TTC. Temporal-slice the adversary into three translucent positions from the preceding second. A single orange distance bracket snaps between the cars; display the **measured** gap/TTC only if it is legible and comes from this run. Title enters on the last beat: `WHO WROTE THIS TEST?`. Sound: engine → low-frequency hit → suspended silence. No crash sound if the run did not collide.

### S02 — The road folds backward

The orange bracket extends into a road ribbon; camera flies backward along it. Behind the live scene, fade in a dark schematic road with a few *unlabelled possible paths* as ghost lines. They are metaphor, not “candidates tested.” Snap the camera to an empty scenario card. Faultline wordmark lands as a small signature, then the line `GENERATE THE HARD CASE`. Reveal three product verbs, not a feature grid: `SPECIFY → CHALLENGE → REPLAY`. Cut into the real app on the final beat.

### S03 — Human intent is visible

Show an actual screen capture of the engineer selecting the policy commitment/build, suite/version, run limit and budget. Use Remotion callout masks to enlarge each chosen field; keep the real UI in the background. The orange road ribbon becomes a progress line below the fields. End on the exact submitted job request. Do not show raw policy code, wallet keys, API keys, tenant key, or bearer permit. If the UI is unfinished, use the real CLI and build a Remotion shell around **its genuine fields and output**, without representing it as a shipped dashboard.

### S04 — Hedera is a transaction, not a logo break

Animate the request as a rectangular packet hitting a vertical violet gate marked `HTTP 402`. Show the real quote: price, Hedera testnet asset, merchant and one-run bound. A visible `merchant ✓ / cap ✓ / amount ✓` checklist flashes in sequence; the buyer signs automatically. The gate opens and the same packet becomes `JOB ACCEPTED`. Match-cut the transaction ID into a **real HashScan recording** for 3–4 seconds, with a large inset showing `SUCCESS` and the amount. Do not film an approval click: the whole point is a client-paid request without per-call human approval.

### S05 — The 0G hero shot

This is the most designed sequence. The accepted packet dives into the CARLA road, which dissolves into a LiDAR-like point cloud. Points rise into a dark three-dimensional *decision chamber*: one large editorial title `01 / PRIVATE COMPUTER` and an official 0G mark. A narrow stream of the actual observation fields enters from the left; one **recorded** action exits on the right as a bright lime arc. Put a real, shortened `request_id` under it and allow the full ID to resolve on hover in the live app or in the linked evidence. The arc lands on the adversary car's roof, and the real CARLA frame resolves around it. Never imply 0G directly controls steering at every frame; the motion graphic depicts a discrete checkpoint decision.

Technical treatment: use a 2.5D SVG lane map and car silhouettes for the transition, with z-depth, parallax and motion blur in Remotion. A short transparent 3D car pass may be pre-rendered and composited, but the real CARLA image must take over before the action occurs. One moving lime arc is the visual signature of every 0G call throughout the film.

### S06 — The product proves the hero shot

Let actual CARLA footage breathe. First decision card at the top edge: `0G → CUT_IN`, shortened request ID, checkpoint number. The lime arc draws the car's **recorded** lane movement over the footage, then vanishes. Show the ego's actual reaction and a small TTC/gap strip. At the next checkpoint, speed-ramp into a second decision card; keep action text accurate to its log. For two seconds, split CARLA chase view with LiDAR or bird's-eye view so the judge sees what the ego perceived. Avoid filling the frame with a terminal. End by pulling the camera up to reveal the full scenario route.

### S07 — A quick trust test

Use a **separate real failure capture**, clearly captioned `RESILIENCE TEST · SEPARATE RUN`. The lime packet stops midair; sound drops out; actual `unreachable` or timeout status appears. The adversary car decelerates under local safe-halt control. A concise red/white stamp reads `NO 0G DECISION → SAFE_HALT`. Cut back to the paid job's route after this beat. Never splice this failure into the paid run as if it happened there.

### S08 — Evidence becomes an artifact

Open the real result screen on the critical tick. Use a three-panel choreography: CARLA replay on left, one chart on right (TTC or gap), one result card centered (`status`, `min TTC`, `collision`). Replay the same 2–3 seconds once; the second pass highlights the adversary action. Then each recorded decision card folds into a narrow evidence strip. The strip passes through two large module titles: `02 / STORAGE` (public root resolves) and `03 / CHAIN` (commit/finalize check resolves). Finish on the actual verifier result and a readable truncated root. The full root belongs in the video description and README.

### S09 — Two networks, one purchased result

Bring back the violet payment packet from S04 and the lime 0G evidence strip from S08. They meet at a small HCS receipt, **not** a giant blockchain animation. Fields appear in this order: payment transaction → job ID → policy commitment → suite/version → `completed` → 0G public root. Keep all values data-driven from this one paid job. Slide the receipt into a real HashScan topic-message recording; briefly show its topic and sequence number, then match-cut back to the 0G root. The visual should explain why HCS exists: payment alone cannot identify the delivered evidence. It is a merchant delivery record, not proof of physical correctness.

### S10 — Leave a memorable image

Return to the frozen road from S01. This time the lime adversary path, replay marker and tiny violet receipt marker are visible on it. Pull up until the road ribbon draws the `F` of Faultline. End card: `FAULTLINE` / `Adversarial road scenarios, paid and replayable` / short demo URL. Hold the URL and logo for at least 3 seconds. End music on a resolved note, not a logo sting.

## Data and capture handoff to the CARLA operator

The editor should receive **one folder for one paid CARLA job**. Do not manufacture a single-job timeline from an unrelated CARLA run and the earlier kinematic Hedera transaction.

```text
video/assets/job-<jobId>/
  carla-master.mp4          # full paid run, clean 1080p or higher
  carla-replay.mp4          # replay of that same run
  app-request.mp4           # actual suite/policy/budget request
  x402-payment.mp4          # quote, automated paid request, accepted job
  hashscan-payment.mp4      # successful payment transaction
  result-verifier.mp4       # metrics, 0G root and verification
  hashscan-hcs.mp4          # HCS message for that job
  evidence.json             # IDs, actions, timings and metrics below; no secrets
video/assets/resilience/
  safe-stop.mp4             # separate failure run; labelled as such
video/vo/S01.wav ... S10.wav
video/audio/music.wav
```

`evidence.json` must contain real values for `jobId`, `suiteId`, `suiteVersion`, `policyCommitment`, `paymentTxId`, `paymentHashScanUrl`, `hcsTopicId`, `hcsSequence`, `hcsHashScanUrl`, `publicRoot`, `episodeId`, `resultStatus`, `minTtcSeconds`, `collision`, and an array of `{checkpoint, requestId, action, source, videoTimeSeconds}`. The editor shortens IDs **only for display**. The same `jobId` and root must agree across the app, payment, result and HCS shot. The safe-stop folder has its own ID and is never merged into the paid job's evidence.

Ask the operator for 5 seconds of clean footage before and after each action; record CARLA output and the UI at native resolution; export the result data separately. Capture the HashScan pages after settlement, not a recreated transaction animation. Keep the original recordings as proof even after cropping and compositing.

## Remotion build instructions

1. Create `video/src/FaultlineMumbai180.tsx` with a parent `Composition` of 5,385 frames. Make ten named `<Sequence>` components using the frame ranges above. Use `interpolate()`/`spring()` for camera, text and packet motion; use `<Video>` from `@remotion/media` for recorded CARLA and browser footage ([Remotion guidance](https://www.remotion.dev/docs/offthreadvideo)). Keep animation state deterministic from `evidence.json` and the frame number.
2. Build reusable layers: `RoadRibbon`, `CarSilhouette`, `DecisionArc`, `EvidenceStrip`, `ReceiptCard`, `IDChip`, `SponsorModuleTitle`, `SafeStopStamp`, `SubtitleLine`. The `DecisionArc` props come from real checkpoint actions. Set a hard guard that rejects missing `requestId`, payment transaction, HCS sequence or root in the **final proof** render.
3. Render abstract backgrounds and overlays in Remotion; composite any optional 3D alpha pass as an asset. Use a real CARLA video for every depicted vehicle maneuver and genuine app/explorer captures for every factual UI state.
4. Import ten ElevenLabs WAVs, one per scene. Put captions in a separate track driven by the exact voice lines above. Mix to roughly −16 LUFS speech and music low enough for every ID and line to be understood; check the final mix on laptop speakers.
5. Review the rendered film at 1× speed with no sound. A judge must still understand **engineer request → Hedera payment → 0G decision → CARLA outcome → replay/evidence → HCS receipt**. Then review with sound, checking that every claim appears on screen when spoken.

After the Remotion project is implemented and `evidence.json` is supplied as composition props, the target render command is:

```bash
npx remotion render video/src/index.ts FaultlineMumbai180 video/out/faultline-mumbai.mp4 --props=video/assets/job-<jobId>/evidence.json
```

The source project and final capture package are inputs to create; this document is the frame-accurate production contract, not a claim that the render command already runs in the repository. Remotion's [CLI](https://www.remotion.dev/docs/cli/render) supports an entry point, composition ID, output path and props file.

**Final render gate:** runtime under 3 minutes; no fabricated transactions, actions, metrics or roots; a real 0G request ID shown during the decision loop; actual 0G Storage root and replay; a real HashScan payment; a real HCS receipt if S09 remains; safe-stop visibly labelled as a separate run. If the paid CARLA and HCS link is not finished, replace S09 with an honestly labelled payment/evidence split and remove the “one purchased result” narration. Do not hide this by editing separate jobs into one visual chain.

The [Mumbai prize page](https://ethglobal.com/events/mumbai/prizes) calls for an under-three-minute 0G video showing an in-loop 0G call, request IDs, replay and safe stop; Hedera asks for the paid request and a HashScan link. This storyboard satisfies both within one film when the capture package is complete.
