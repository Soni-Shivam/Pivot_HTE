# Regression idm-follower 1.0 -> 1.1 (runs/memory-001)

Models: v1.0 digest `56592f0463f1a04af3e339c1349cfd3aa7132eaafc8042493e61eb2b6ab79d8c`, v1.1 digest `1f2328936cd0df03edf1036f4729e38b71e24966007d333d092561d23360938c` (params {"comfort_decel_mps2":2.0,"max_accel_mps2":3.0,"min_gap_m":5.0,"min_time_headway_s":2.0}). Paired tests: 135. safe = no collision AND min bumper-to-bumper gap >= 2.0 m.

| category | n | unsafe v1.0 | unsafe v1.1 | collisions v1.0 | collisions v1.1 | fixed | regressions | status | mean speed 1.0 → 1.1 |
|---|---|---|---|---|---|---|---|---|---|
| low_friction | 11 | 7/11 = 63.6 % [35.4, 84.8] | 1/11 = 9.1 % [1.6, 37.7] | 5/11 = 45.5 % [21.3, 72.0] | 1/11 = 9.1 % [1.6, 37.7] | 6 | 0 | **improved** | 15.8971 → 13.1914 |
| slow_reaction | 27 | 24/27 = 88.9 % [71.9, 96.1] | 3/27 = 11.1 % [3.9, 28.1] | 9/27 = 33.3 % [18.6, 52.2] | 2/27 = 7.4 % [2.1, 23.4] | 21 | 0 | **improved** | 13.5042 → 11.9617 |
| hard_brake | 30 | 22/30 = 73.3 % [55.6, 85.8] | 0/30 = 0.0 % [0.0, 11.4] | 6/30 = 20.0 % [9.5, 37.3] | 0/30 = 0.0 % [0.0, 11.4] | 22 | 0 | **improved** | 11.8009 → 9.9268 |
| lead_brake | 67 | 51/67 = 76.1 % [64.7, 84.7] | 0/67 = 0.0 % [0.0, 5.4] | 9/67 = 13.4 % [7.2, 23.6] | 0/67 = 0.0 % [0.0, 5.4] | 51 | 0 | **improved** | 13.0031 → 11.0394 |

Overall unsafe 104/135 = 77.0 % [69.3, 83.3] → 4/135 = 3.0 % [1.2, 7.4]; collisions 29/135 = 21.5 % [15.4, 29.1] → 3/135 = 2.2 % [0.8, 6.3]; mean speed 13.072 → 11.1519 m/s, cruise THW 2.3837 → 2.6499 s.

| fingerprint | status | cases | unsafe on v1.1 |
|---|---|---|---|
| `collision/ttc_collapse/friction_limited/braking_phase/after_lead_stopped` | **fixed** | 6 | 0 |
| `collision/ttc_collapse/friction_limited/braking_phase/during_lead_braking` | **persists** | 11 | 1 |
| `collision/ttc_collapse/friction_limited/reaction_delay/during_lead_braking` | **persists** | 1 | 1 |
| `collision/ttc_collapse/grip_available/braking_phase/after_lead_stopped` | **persists** | 4 | 2 |
| `collision/ttc_collapse/grip_available/braking_phase/during_lead_braking` | **fixed** | 7 | 0 |
| `margin/gap_below_margin/grip_available/braking_phase/after_lead_stopped` | **fixed** | 11 | 0 |
| `margin/gap_below_margin/grip_available/braking_phase/during_lead_braking` | **fixed** | 4 | 0 |
| `margin/ttc_collapse/friction_limited/braking_phase/after_lead_stopped` | **fixed** | 25 | 0 |
| `margin/ttc_collapse/friction_limited/braking_phase/during_lead_braking` | **fixed** | 11 | 0 |
| `margin/ttc_collapse/grip_available/braking_phase/after_lead_stopped` | **fixed** | 24 | 0 |

## System 2 (0G) extra experiments
status ok; why: v1.1 improved safety but increased min_gap and reduced comfort_decel. Testing extremes of speed, friction, gap, and delay checks for new weaknesses like overshoot, excessive following distance, or instability at friction limits.
- ran {"brake_onset_s":3.0,"ego_speed_mps":30.0,"friction_mu":0.4,"initial_gap_m":10.0,"lead_decel_mps2":9.0,"reaction_delay_s":1.5} — Test extreme low-friction, high-speed, short-gap hard braking with max delay to check if v1.1's larger min_gap causes overshoot or instability. → v1.0 {'collision': True, 'fingerprint': 'collision/ttc_collapse/friction_limited/braking_phase/during_lead_braking', 'min_gap_m': -0.2711, 'safe': False} v1.1 {'collision': True, 'fingerprint': 'collision/ttc_collapse/friction_limited/braking_phase/after_lead_stopped', 'min_gap_m': -0.124, 'safe': False}
- ran {"brake_onset_s":3.0,"ego_speed_mps":30.0,"friction_mu":0.9,"initial_gap_m":10.0,"lead_decel_mps2":9.0,"reaction_delay_s":1.5} — Test extreme grip, high-speed, short-gap hard braking with max delay to check if v1.1's aggressive braking causes rear-end collision. → v1.0 {'collision': True, 'fingerprint': 'collision/ttc_collapse/friction_limited/reaction_delay/during_lead_braking', 'min_gap_m': -0.4851, 'safe': False} v1.1 {'collision': True, 'fingerprint': 'collision/ttc_collapse/friction_limited/braking_phase/after_lead_stopped', 'min_gap_m': -0.3752, 'safe': False}
- ran {"brake_onset_s":3.0,"ego_speed_mps":30.0,"friction_mu":0.4,"initial_gap_m":80.0,"lead_decel_mps2":1.0,"reaction_delay_s":0.2} — Test low-friction, high-speed, long-gap, gentle lead decel with min delay to check if v1.1's comfort_decel is too low for efficient following. → v1.0 {'collision': False, 'fingerprint': None, 'min_gap_m': 13.5827, 'safe': True} v1.1 {'collision': False, 'fingerprint': None, 'min_gap_m': 17.5887, 'safe': True}
- ran {"brake_onset_s":10.0,"ego_speed_mps":8.0,"friction_mu":0.9,"initial_gap_m":5.0,"lead_decel_mps2":1.0,"reaction_delay_s":0.2} — Test low-speed, short-gap, high-grip, gentle lead decel with min delay to check if v1.1's min_gap=5.0 causes excessive following distance. → v1.0 {'collision': False, 'fingerprint': 'margin/gap_below_margin/grip_available/braking_phase/during_lead_braking', 'min_gap_m': 1.5405, 'safe': False} v1.1 {'collision': False, 'fingerprint': None, 'min_gap_m': 5.0177, 'safe': True}
- ran {"brake_onset_s":5.0,"ego_speed_mps":20.0,"friction_mu":0.5,"initial_gap_m":20.0,"lead_decel_mps2":6.0,"reaction_delay_s":1.0} — Test boundary friction, moderate speed, moderate gap, hard lead brake with moderate delay to check for new failure modes at friction limits. → v1.0 {'collision': True, 'fingerprint': 'collision/ttc_collapse/friction_limited/braking_phase/during_lead_braking', 'min_gap_m': -0.304, 'safe': False} v1.1 {'collision': False, 'fingerprint': None, 'min_gap_m': 2.0948, 'safe': True}
- ran {"brake_onset_s":8.0,"ego_speed_mps":15.0,"friction_mu":0.8,"initial_gap_m":30.0,"lead_decel_mps2":2.0,"reaction_delay_s":1.2} — Test moderate conditions with slow reaction to check if v1.1's improved slow_reaction performance holds or if new edge cases emerge. → v1.0 {'collision': True, 'fingerprint': 'collision/ttc_collapse/grip_available/braking_phase/during_lead_braking', 'min_gap_m': -0.1337, 'safe': False} v1.1 {'collision': False, 'fingerprint': None, 'min_gap_m': 2.2105, 'safe': True}

## 0G report (audited)
status ok

Regression report for idm-follower v1.0 to v1.1 shows significant safety improvements. Overall collision rate dropped from 0.215 to 0.022, and unsafe rate from 0.770 to 0.030. All four categories (low_friction, slow_reaction, hard_brake, lead_brake) improved. However, one collision fingerprint persists in low_friction scenarios during lead braking. Efficiency metrics indicate reduced mean speed and increased time-to-whistle, suggesting more conservative following behavior.

- **supported** — Overall collision rate decreased from 0.215 in v1.0 to 0.022 in v1.1. (measured collision rate 0.214815 (29/135))
- **supported** — Overall collision rate decreased from 0.022 in v1.1 to 0.022 in v1.1. (measured collision rate 0.022222 (3/135))
- **supported** — Overall unsafe rate decreased from 0.770 in v1.0 to 0.030 in v1.1. (measured unsafe rate 0.77037 (104/135))
- **supported** — Overall unsafe rate decreased from 0.030 in v1.1 to 0.030 in v1.1. (measured unsafe rate 0.02963 (4/135))
- **supported** — Collision fingerprint 'collision/ttc_collapse/friction_limited/braking_phase/during_lead_braking' persists in v1.1. (classified persists (1/11 cases unsafe on 1.1))
- **supported** — Collision fingerprint 'collision/ttc_collapse/friction_limited/reaction_delay/during_lead_braking' persists in v1.1. (classified persists (1/1 cases unsafe on 1.1))
- **supported** — Collision fingerprint 'collision/ttc_collapse/grip_available/braking_phase/after_lead_stopped' persists in v1.1. (classified persists (2/4 cases unsafe on 1.1))
- **supported** — Category 'low_friction' improved from v1.0 to v1.1. (classified improved (regressions 0, fixed 6))
- **supported** — Category 'slow_reaction' improved from v1.0 to v1.1. (classified improved (regressions 0, fixed 21))
- **supported** — Category 'hard_brake' improved from v1.0 to v1.1. (classified improved (regressions 0, fixed 22))
- **supported** — Category 'lead_brake' improved from v1.0 to v1.1. (classified improved (regressions 0, fixed 51))

Audit counts {'supported': 11, 'contradicted': 0, 'malformed': 0}
0G calls: {'cost_usd': 0.00145, 'inference_calls': 2, 'latency_ms': [8695, 9409], 'providers': ['0xf4FB8d2bD856e672b5f9848b0eD235A20079B250'], 'request_ids': ['b2aed5f9-d6a8-4392-8ca2-1260ff907a7e', '5d2aa9fa-653c-4127-877e-c15fffd783e8'], 'tokens': {'completion_tokens': 1825, 'prompt_tokens': 7163}}

Rebuilt: {'at': '2026-11-07T04:59:35', 'audit_counts_before': {'contradicted': 4, 'malformed': 0, 'supported': 7}, 'why': "audit now checks category 'overall' (present in the report prompt's data as 'overall') instead of calling it unknown"}
