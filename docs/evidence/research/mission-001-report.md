# Verifiable Safety Report

**Mission:** Find a scenario where this autonomous vehicle cannot avoid a collision, explain why, give me the simplest reproduction, and test a fix  
**Status:** completed   
**Budget:** 30 experiments (32 used incl. 2 deterministic completion runs)  
**Agent:** 0gm-1.0-35b-a3b, private tier, 9 calls, providers ['0xf4FB8d2bD856e672b5f9848b0eD235A20079B250']  
**Safety:** safe = no collision AND min bumper-to-bumper gap >= 2.0 m

Two separate claims. *Signed inference authenticity*: each 0G response below carries a request id and a provider signature (Zg-Res-Key) checked with `npm run faultline -- sigs designer.jsonl`; it shows which model chose each tool. *Simulation integrity*: each experiment carries a config hash over controller params, simulator settings and code, scenario, model id and prompt hash; anyone can re-run it. Neither implies the other. All CARLA clips are scripted executions of 0G-chosen parameters.

## Tested conditions

| parameter | min tested | max tested | frozen range |
|---|---|---|---|
| ego_speed_mps | 15 | 20 | 8–30 |
| initial_gap_m | 20 | 61.25 | 5–80 |
| lead_decel_mps2 | 3 | 6 | 1–9 |
| friction_mu | 0.3 | 0.8 | 0.3–1 |
| reaction_delay_s | 0.4 | 0.6 | 0.2–1.5 |
| brake_onset_s | 5 | 5 | 3–10 |

## Loop (tool chosen by 0G → deterministic result)

1. **probe** `{"experiment":{"brake_onset_s":5.0,"ego_speed_mps":15.0,"friction_mu":0.8,"initial_gap_m":61.25,"lead_decel_mps2":6.0,"reaction_delay_s":0.6}}` → ok, runs [1]–[1], J 1.3457; request `93335606-cd77-4e07-ac73-9b8ffe2a2cee`  
   *Hypothesis:* High friction allows sufficient braking force, but long reaction delay causes TTC collapse even with grip. Testing if reducing delay resolves this specific 'grip_available/ttc_collapse' failure mode.
2. **probe** `{"experiment":{"brake_onset_s":5.0,"ego_speed_mps":15.0,"friction_mu":0.8,"initial_gap_m":35.0,"lead_decel_mps2":6.0,"reaction_delay_s":0.6}}` → ok, runs [2]–[2], J 0.8388; request `71ca1de7-47b6-476f-8a75-116e8c6166fe`  
   *Hypothesis:* At 15 m/s and 6.0 m/s² lead decel, 0.6s delay causes collision below 42.5m. Testing 35m gap to pinpoint failure threshold.
3. **probe** `{"experiment":{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.3,"initial_gap_m":20.0,"lead_decel_mps2":6.0,"reaction_delay_s":0.6}}` → ok, runs [3]–[3], J 1.6334; request `a10e8908-5529-4883-85c9-37b2b413a898`  
   *Hypothesis:* Collision occurs when ego speed is high, gap is tight, and friction is low, causing TTC collapse before ego can brake sufficiently.
4. **probe** `{"experiment":{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.3,"initial_gap_m":20.0,"lead_decel_mps2":6.0,"reaction_delay_s":0.6}}` → ok, runs [4]–[4], J 1.0; request `b7e2d016-6917-40e4-97d4-49ddfc2da641`  
   *Hypothesis:* Collision occurs when ego speed is high, friction is low, and initial gap is small, causing TTC collapse during lead braking. The controller cannot decelerate fast enough to maintain safe gap.
5. **minimize** `{"case_id":3}` → ok, runs [5]–[29], J 1.0701; request `8c34bbd6-f760-44f6-a71e-5399b9941bf2`  
   *Hypothesis:* Collision occurs when ego speed and lead decel exceed friction-limited stopping capability within the reaction delay and initial gap.
6. **probe** `{"experiment":{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}}` → ok, runs [30]–[30], J 1.0; request `608fefda-eca1-494c-8faf-d36388670131`  
   *Hypothesis:* The controller fails when lead deceleration exceeds the ego's ability to brake within the reaction delay and available friction, specifically during the braking phase.

## Failures and fingerprints

| n | tool | params | outcome | fingerprint | config hash |
|---|---|---|---|---|---|
| 2 | probe | `{"brake_onset_s":5.0,"ego_speed_mps":15.0,"friction_mu":0.8,"initial_gap_m":35.0,"lead_decel_mps2":6.0,"reaction_delay_s":0.6}` | margin min gap 1.788 | margin/ttc_collapse/grip_available/braking_phase/after_lead_stopped | `446564f9bc9daefb…` |
| 3 | probe | `{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.3,"initial_gap_m":20.0,"lead_decel_mps2":6.0,"reaction_delay_s":0.6}` | collision min gap -0.0956 | collision/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `f335c225e33d8a22…` |
| 4 | probe | `{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.3,"initial_gap_m":20.0,"lead_decel_mps2":6.0,"reaction_delay_s":0.6}` | collision min gap -0.0956 | collision/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `f335c225e33d8a22…` |
| 5 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.8,"initial_gap_m":20.0,"lead_decel_mps2":6.0,"reaction_delay_s":0.6}` | collision min gap -0.2014 | collision/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `3662994c4ab2a262…` |
| 6 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.8,"initial_gap_m":20.0,"lead_decel_mps2":3.0,"reaction_delay_s":0.6}` | margin min gap 0.5341 | margin/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `7e674947f0a55dd5…` |
| 7 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.8,"initial_gap_m":20.0,"lead_decel_mps2":4.5,"reaction_delay_s":0.6}` | collision min gap -0.0787 | collision/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `0df7e30d8cdf662b…` |
| 8 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.8,"initial_gap_m":20.0,"lead_decel_mps2":3.75,"reaction_delay_s":0.6}` | collision min gap -0.0189 | collision/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `efa96ae067ee83e1…` |
| 9 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.8,"initial_gap_m":20.0,"lead_decel_mps2":3.375,"reaction_delay_s":0.6}` | margin min gap 0.2022 | margin/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `ab702e2723cfd102…` |
| 10 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.8,"initial_gap_m":40.0,"lead_decel_mps2":3.75,"reaction_delay_s":0.6}` | margin min gap 1.2841 | margin/ttc_collapse/grip_available/braking_phase/after_lead_stopped | `8997e7191066f4bf…` |
| 11 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.8,"initial_gap_m":30.0,"lead_decel_mps2":3.75,"reaction_delay_s":0.6}` | margin min gap 0.2513 | margin/ttc_collapse/friction_limited/braking_phase/after_lead_stopped | `df3e374908677fd3…` |
| 12 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.75,"reaction_delay_s":0.6}` | collision min gap -0.0324 | collision/ttc_collapse/grip_available/braking_phase/during_lead_braking | `4cfd6037e61ac37e…` |
| 13 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.8,"initial_gap_m":27.5,"lead_decel_mps2":3.75,"reaction_delay_s":0.6}` | margin min gap 0.0275 | margin/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `c7a7fba8fdfe55f3…` |
| 14 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":15.0,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.75,"reaction_delay_s":0.6}` | margin min gap 0.6155 | margin/ttc_collapse/friction_limited/braking_phase/after_lead_stopped | `cb1142c808cab490…` |
| 15 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":17.5,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.75,"reaction_delay_s":0.6}` | margin min gap 0.0919 | margin/ttc_collapse/friction_limited/braking_phase/after_lead_stopped | `fe60cddf929f6145…` |
| 16 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.75,"reaction_delay_s":0.6}` | collision min gap -0.0012 | collision/ttc_collapse/grip_available/braking_phase/during_lead_braking | `2cde8cd62a0c6da8…` |
| 17 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":18.125,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.75,"reaction_delay_s":0.6}` | margin min gap 0.0055 | margin/ttc_collapse/friction_limited/braking_phase/after_lead_stopped | `5b715dfa082a12b8…` |
| 18 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.0,"reaction_delay_s":0.6}` | margin min gap 0.3704 | margin/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `d076a3bcf10a36b7…` |
| 19 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.375,"reaction_delay_s":0.6}` | margin min gap 0.1448 | margin/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `221ab3d50be732dd…` |
| 20 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.5625,"reaction_delay_s":0.6}` | margin min gap 0.0644 | margin/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `c87d49e0ebe9fab7…` |
| 21 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` | collision min gap -0.0078 | collision/ttc_collapse/grip_available/braking_phase/during_lead_braking | `91fdd22516a59c40…` |
| 22 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":40.0,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` | margin min gap 1.5166 | margin/ttc_collapse/grip_available/braking_phase/after_lead_stopped | `6868e43f1d3c48f0…` |
| 23 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":32.5,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` | margin min gap 0.7556 | margin/ttc_collapse/friction_limited/braking_phase/after_lead_stopped | `b42ef8530f845caf…` |
| 24 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":28.75,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` | margin min gap 0.3365 | margin/ttc_collapse/friction_limited/braking_phase/after_lead_stopped | `a6f0f1a7b737ec43…` |
| 25 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":26.875,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` | margin min gap 0.1466 | margin/ttc_collapse/friction_limited/braking_phase/after_lead_stopped | `e0dd08bec997672e…` |
| 26 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":15.0,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` | margin min gap 0.6353 | margin/ttc_collapse/friction_limited/braking_phase/after_lead_stopped | `8264dca3205776c9…` |
| 27 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":16.875,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` | margin min gap 0.2229 | margin/ttc_collapse/friction_limited/braking_phase/after_lead_stopped | `1d9f7d9fb5fcaa81…` |
| 28 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":17.8125,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` | margin min gap 0.0805 | margin/ttc_collapse/friction_limited/braking_phase/after_lead_stopped | `82fc6eaaf12d10d2…` |
| 29 | minimize | `{"brake_onset_s":5.0,"ego_speed_mps":18.2812,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` | margin min gap 0.0247 | margin/ttc_collapse/friction_limited/braking_phase/during_lead_braking | `48fef8f2beff4052…` |
| 30 | probe | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` | collision min gap -0.0078 | collision/ttc_collapse/grip_available/braking_phase/during_lead_braking | `91fdd22516a59c40…` |
| 31 | counterfactual[deterministic] | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.6562,"reaction_delay_s":0.4}` | margin min gap 1.1365 | margin/ttc_collapse/grip_available/braking_phase/after_lead_stopped | `250ba31aa005df86…` |
| 32 | counterfactual[deterministic] | `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":35.0,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` | margin min gap 1.0313 | margin/ttc_collapse/grip_available/braking_phase/after_lead_stopped | `da16eb859bec92de…` |

Distinct fingerprints this mission: 5; library before: 6 fingerprints; new library rows: 28.

## Minimized case

- from experiment 3 (still collides, done, 25 runs): minimal case **#21** `{"brake_onset_s":5.0,"ego_speed_mps":18.75,"friction_mu":0.8,"initial_gap_m":25.0,"lead_decel_mps2":3.6562,"reaction_delay_s":0.6}` → {'n': 21, 'safe': False, 'collision': True, 'min_gap_m': -0.0078, 'fingerprint': 'collision/ttc_collapse/grip_available/braking_phase/during_lead_braking'}
  - necessary **lead_decel_mps2** = 3.6562 (reference 3.0): restoring it alone → safe True, min gap 0.3704 m (run 18)
  - necessary **initial_gap_m** = 25.0 (reference 40.0): restoring it alone → safe True, min gap 1.5166 m (run 22)
  - necessary **ego_speed_mps** = 18.75 (reference 15.0): restoring it alone → safe True, min gap 0.6353 m (run 26)

## Counterfactual evidence

| case | change | run | min gap before → after | Δ | safety flipped | collision flipped |
|---|---|---|---|---|---|---|
| 21 | `{"reaction_delay_s":-0.2}` | 31 | -0.0078 → 1.1365 | 1.1443 | False | True |
| 21 | `{"initial_gap_m":10.0}` | 32 | -0.0078 → 1.0313 | 1.0391 | False | True |

## 0G explanation

> The controller fails because the ego vehicle's braking capability, limited by friction and reaction delay, is insufficient to match the lead vehicle's deceleration in tight gaps. Specifically, at 18.75 m/s with 0.6s delay and 0.8 friction, a lead decel of 3.6562 m/s² causes a collision at 25m gap. Reducing delay or increasing gap prevents collision.

Minimal reproduction (0G): Run 21: ego_speed=18.75, initial_gap=25.0, lead_decel=3.6562, reaction_delay=0.6, friction=0.8. Result: Collision.

## AI reasoning vs physical reality (audit)

Counts: {'supported': 5, 'contradicted': 2, 'unverifiable': 1, 'malformed': 0, 'conservative': 0, 'extrapolated': 0}

| claim | cites | verdict | detail |
|---|---|---|---|
| At reaction_delay_s=0.6, ego_speed=18.75, friction=0.8, and lead_decel=3.6562, a collision occurs when initial_gap is 25.0m. | [21, 30] | **supported** | all cited runs are collision |
| At reaction_delay_s=0.6, ego_speed=18.75, friction=0.8, and lead_decel=3.6562, no collision occurs when initial_gap is 25.0m and reaction_delay is reduced to 0. | [31] | **supported** | all cited runs are no_collision |
| At reaction_delay_s=0.6, ego_speed=18.75, friction=0.8, and lead_decel=3.6562, no collision occurs when initial_gap is 35.0m. | [32] | **supported** | all cited runs are no_collision |
| Reducing reaction_delay_s from 0.6 to 0.4 prevents collision in the minimal failing scenario. | [21, 31] | **supported** | 1 cited pair(s) agree |
| Increasing initial_gap_m from 25.0 to 35.0 prevents collision in the minimal failing scenario. | [21, 32] | **supported** | 1 cited pair(s) agree |
| The controller fails because the ego vehicle cannot decelerate sufficiently within the reaction delay and available friction to avoid a collision when the lead  | [21, 31, 32] | **contradicted** | blames friction-limited braking, but the ego never reached the friction limit (run 21: ego peak decel 5.7614 vs friction limit 6.28 m/s^2; run 31: ego peak decel 4.4568 vs friction limit 6.28 m/s^2; run 32: ego peak decel 4.6299 vs friction limit 6.28 m/s^2) |
| [explanation] The controller fails because the ego vehicle's braking capability, limited by friction and reaction delay, is insufficient to match the lead vehic | [21] | **contradicted** | blames friction-limited braking, but the ego never reached the friction limit (run 21: ego peak decel 5.7614 vs friction limit 6.28 m/s^2) |

- ⚠ claim contradicted: The controller fails because the ego vehicle cannot decelerate sufficiently within the reaction delay and available friction to avoid a collision when the lead vehicle brakes hard. (blames friction-limited braking, but the ego never reached the friction limit (run 21: ego peak decel 5.7614 vs friction limit 6.28 m/s^2; run 31: ego peak decel 4.4568 vs friction limit 6.28 m/s^2; run 32: ego peak decel 4.6299 vs friction limit 6.28 m/s^2))
- ⚠ claim contradicted: [explanation] The controller fails because the ego vehicle's braking capability, limited by friction and reaction delay, is insufficient to match the lead vehicle's deceleration in tight gaps. Specifically, at 18.75 m/s with 0.6s delay and 0.8 friction, a lead decel of 3.6562 m/s² causes a collision at 25m gap. Reducing delay or increasing gap prevents collision. (blames friction-limited braking, but the ego never reached the friction limit (run 21: ego peak decel 5.7614 vs friction limit 6.28 m/s^2))

## Fix and retest

### Attempt 1 (request `875911af-c222-452a-91db-08d399532f71`)

Proposal: `{"min_gap_m":3.0}` — Increase min_gap_m to 3.0m to provide sufficient buffer for the ego vehicle to brake safely without collision, staying within frozen bounds.

- failing case: before safe False (min gap -0.0078) → after safe False (min gap 0.3579)
- regression suite (40): unsafe before 19, after 13; regressions []; newly safe [21, 24, 26, 29, 36, 39]
- efficiency (suite means): speed {'before': 11.7714, 'after': 11.8741}, cruise time headway {'before': 3.1763, 'after': 3.1763}
- config hash before `1d3928abd50c895f…` after `810334f2bd08240c…`
- **verdict: no-change**

### Attempt 2 (request `1104b23b-f8f9-40fc-b50b-e5ddbf4359ea`)

Proposal: `{"min_gap_m":3.0}` — Increase min_gap_m to 3.0m to provide sufficient buffer against collision during braking phase.

- failing case: before safe False (min gap -0.0078) → after safe False (min gap 0.3579)
- regression suite (40): unsafe before 19, after 13; regressions []; newly safe [21, 24, 26, 29, 36, 39]
- efficiency (suite means): speed {'before': 11.7714, 'after': 11.8741}, cruise time headway {'before': 3.1763, 'after': 3.1763}
- config hash before `1d3928abd50c895f…` after `810334f2bd08240c…`
- **verdict: no-change**

**classical baseline: deterministic grid over the frozen controller bounds (not 0G)**: 240 controllers tested on the failing case, 67 make it safe, 65 pass the improvement rule.
- best improved: `{"comfort_decel_mps2":4.5,"max_accel_mps2":1.5,"min_gap_m":5.0,"min_time_headway_s":2.0}` → case min gap 3.0102, suite unsafe 19 → 9, mean speed {'before': 11.7714, 'after': 12.1447}, cruise THW {'before': 3.1763, 'after': 3.2925}
- fewest suite unsafe: `{"comfort_decel_mps2":2.0,"max_accel_mps2":3.0,"min_gap_m":5.0,"min_time_headway_s":2.0}` → case min gap 4.7407, suite unsafe 19 → 0, mean speed {'before': 11.7714, 'after': 10.7871}, cruise THW {'before': 3.1763, 'after': 3.3038}

Retest of all 31 unsafe mission cases with `{"min_gap_m":3.0}`: 2 now safe.

## Uncertainty

- The exact safe gap boundary at 18.75 m/s is between 25.0m and 35.0m. Further testing is needed to pinpoint the exact threshold.
- One deterministic 1-D simulator (kinematic integrator); CARLA replays use the same integrator for motion.
- The fix is judged on a 40-scenario frozen suite (21 safe with the current controller), not on the whole space.

## Config hashes

| n | config hash |
|---|---|
| 1 | `117d0131e62e60c5799309611dd6fb1c2d7edb4fff34f1473f5205cc5a20bbb6` |
| 2 | `446564f9bc9daefb747ae0b9521125eaa74a834c57cee5291886a9295ea781e3` |
| 3 | `f335c225e33d8a225f90e6beea93d3c19678b56b2ec663598140a4f2d8bf1322` |
| 4 | `f335c225e33d8a225f90e6beea93d3c19678b56b2ec663598140a4f2d8bf1322` |
| 5 | `3662994c4ab2a2622981aa52e8ad2359104f2c6e466f2d83f68b74c5359fafd2` |
| 6 | `7e674947f0a55dd529e3e2dfa69eb3ca86dd59a5d220e6f4f2ae27c8e703b41d` |
| 7 | `0df7e30d8cdf662b3ebdb0ba96074f9db9b0e3fb5ed9885da7f903098385e6de` |
| 8 | `efa96ae067ee83e1e1aaceaf6f2393c68c9be598c71c5f56693aeaeb9e0da6a2` |
| 9 | `ab702e2723cfd102dbd2929518eef3db375a6d699c4481666335cb9734f0dd27` |
| 10 | `8997e7191066f4bf37354060e5fce2f9f9ae29421d0f8471efa3e42e17373995` |
| 11 | `df3e374908677fd3ed0874dc886476066bb40fdec703437ec6439c948eabf2c8` |
| 12 | `4cfd6037e61ac37e1c28139130a0864414efba0c7a7dd26eb4def3a04715970a` |
| 13 | `c7a7fba8fdfe55f3aa9e50b72e327df545d456158805d0d1d40b4a54963d168c` |
| 14 | `cb1142c808cab49033e8404096df1b722a82c140ca118597ff769a32ae2ce92c` |
| 15 | `fe60cddf929f6145803faf8eb931c80a56a5ef0c59160a79e082bad6a119c1c6` |
| 16 | `2cde8cd62a0c6da82d25dcdbcfa43cfcae50ad683fde01a72400bebb595267d1` |
| 17 | `5b715dfa082a12b80666d1278045441634714577342948780d7c5fb43112d3f8` |
| 18 | `d076a3bcf10a36b7a811055daf71c4a27481938079d0fb35915ddf1e2cd314ea` |
| 19 | `221ab3d50be732dd5ce244ae95dbaefeb27081a92ecb9bcfeadfe3fd1e52c28d` |
| 20 | `c87d49e0ebe9fab70f23348d43254b3cdc2ced26c4b345ccb3605ce6d5b3173a` |
| 21 | `91fdd22516a59c40abeac409fff83f4c4c4ccae8ecaab73245c123c155d1ac71` |
| 22 | `6868e43f1d3c48f0b5c567071a6d60fd890b0e7b3e2cd41aed01f05d66ba0246` |
| 23 | `b42ef8530f845caf201c555f1f850e19e2a761be385a4773a5cbc1723b5a7207` |
| 24 | `a6f0f1a7b737ec437418a04c15376afd85db8f9e7fdbabed593c8130f61d1127` |
| 25 | `e0dd08bec997672e698eefc04c12358ea7329cc4e7b8dc925d81a146f4b54d9e` |
| 26 | `8264dca3205776c9c664bc88e5907442f6e1ba699936a8d12c11490a3e92a9e2` |
| 27 | `1d9f7d9fb5fcaa811c4f5af350d50d3e521fcc7f9063ac4fa630844bfc402cca` |
| 28 | `82fc6eaaf12d10d2bf786e9d6776ecbe871cbaa5a53d79281d224c111a56ee7e` |
| 29 | `48fef8f2beff405200e6515c6f61fdd140d155fc2b0952e9036c7a2b2fa695d8` |
| 30 | `91fdd22516a59c40abeac409fff83f4c4c4ccae8ecaab73245c123c155d1ac71` |
| 31 | `250ba31aa005df869672ad75943bd83da517d3fd9290979d53860921ae6d8e55` |
| 32 | `da16eb859bec92de6cc17018ff34baa3851bf9876a5787a964c5ecbadc66d3ac` |

## Every 0G request

Chain head `2c5eb32974b946326353967ac299f564f8ec5a839247a98cdd6379e0e768b4c8` (verify_chain: True).

- `93335606-cd77-4e07-ac73-9b8ffe2a2cee`
- `71ca1de7-47b6-476f-8a75-116e8c6166fe`
- `a10e8908-5529-4883-85c9-37b2b413a898`
- `b7e2d016-6917-40e4-97d4-49ddfc2da641`
- `8c34bbd6-f760-44f6-a71e-5399b9941bf2`
- `608fefda-eca1-494c-8faf-d36388670131`
- `7f14b80a-1f3a-4bc4-b8da-5dce12921cd6`
- `875911af-c222-452a-91db-08d399532f71`
- `1104b23b-f8f9-40fc-b50b-e5ddbf4359ea`
