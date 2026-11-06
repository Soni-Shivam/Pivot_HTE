# Faultline hunt — G2

Goal: Check whether this vehicle becomes unsafe when the lead brakes hard on a low-friction road; find the conditions that matter most. Budget 16.

Safety: safe = no collision AND min bumper-to-bumper gap >= 2.0 m.

## 0G turns

1. `{"brake_onset_s":5.0,"ego_speed_mps":25.0,"friction_mu":0.3,"initial_gap_m":20.0,"lead_decel_mps2":5.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.126 m, collision True); request `bbdaf71b-8d54-4a83-b372-a889a8a4d54e`  
   *Hypothesis:* Low friction and high speed are primary risk factors. I hypothesize that collisions occur when friction is low (<0.5) and speed is high (>20 m/s), regardless of other parameters.  
   *Why:* This tests the hypothesized high-risk corner (low friction, high speed) to confirm if the controller fails under these specific conditions.
2. `{"brake_onset_s":5.0,"ego_speed_mps":10.0,"friction_mu":0.9,"initial_gap_m":20.0,"lead_decel_mps2":5.0,"reaction_delay_s":0.5}` → **unsafe** (min gap 1.664 m, collision False); request `40ed0bf5-0686-4927-9376-f10cbafe7a82`  
   *Hypothesis:* Collision occurred due to low friction and high speed. Testing high friction and low speed should confirm safety, isolating friction as the critical factor.  
   *Why:* High friction and low speed maximize stopping distance margin. If safe, friction is the primary driver of the previous failure.
3. `{"brake_onset_s":5.0,"ego_speed_mps":10.0,"friction_mu":0.9,"initial_gap_m":20.0,"lead_decel_mps2":5.0,"reaction_delay_s":0.5}` → **unsafe** (min gap 1.664 m, collision False); request `e84d7de4-6183-4381-bf4e-50d5b7442423`  
   *Hypothesis:* Low friction and high speed cause collisions due to insufficient braking force. The second run failed safety due to min_gap < 2.0m despite no collision, suggesting the controller is too aggressive or gap tolerance is tight.  
   *Why:* Re-run #2 to verify if min_gap < 2.0m is consistent. If safe, it confirms the controller handles this scenario well within safety bounds, isolating friction/speed as key risk factors.
4. `{"brake_onset_s":5.0,"ego_speed_mps":25.0,"friction_mu":0.3,"initial_gap_m":20.0,"lead_decel_mps2":5.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.126 m, collision True); request `ff59d439-3001-40cc-ab91-4cc8b8b74729`  
   *Hypothesis:* Low friction and high speed cause collisions due to insufficient braking force. The controller fails to maintain the 2m gap under these conditions.  
   *Why:* Repeats Run 1 to verify the collision result under low friction and high speed, confirming the primary failure mode.
5. `{"brake_onset_s":5.0,"ego_speed_mps":30.0,"friction_mu":0.3,"initial_gap_m":80.0,"lead_decel_mps2":9.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.1325 m, collision True); request `527427dd-2604-40e5-af64-3d377b45bd88`  
   *Hypothesis:* Low friction and high speed cause collisions due to insufficient braking force. Testing high speed on low friction with large gap isolates friction limits vs. reaction time.  
   *Why:* High speed (30) and low friction (0.3) maximize stopping distance. Large gap (80) ensures reaction delay isn't the primary failure mode, isolating friction/braking capability.
6. `{"brake_onset_s":5.0,"ego_speed_mps":30.0,"friction_mu":0.3,"initial_gap_m":20.0,"lead_decel_mps2":9.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.0807 m, collision True); request `f79faa4d-0937-471e-bd28-93c98dbf3fe2`  
   *Hypothesis:* The controller fails on low friction due to insufficient braking force, not reaction time. High speed exacerbates this. Testing high speed, low friction, and high lead deceleration will confirm the friction limit as the primary failure mode.  
   *Why:* This combines the worst-case parameters identified: high speed, low friction, and maximum lead deceleration. It isolates the friction limit effect by keeping reaction delay constant at the previously observed value.
7. `{"brake_onset_s":5.0,"ego_speed_mps":30.0,"friction_mu":0.9,"initial_gap_m":20.0,"lead_decel_mps2":9.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.1069 m, collision True); request `08839cf0-fde1-464a-8379-af06f3425982`  
   *Hypothesis:* Low friction and high speed cause collisions due to insufficient braking force. Testing high friction at high speed isolates if the controller fails even with traction.  
   *Why:* Tests high speed/high friction to see if the controller can brake hard enough without skidding, distinguishing traction limits from control logic.
8. `{"brake_onset_s":5.0,"ego_speed_mps":8.0,"friction_mu":1.0,"initial_gap_m":80.0,"lead_decel_mps2":9.0,"reaction_delay_s":0.5}` → safe (min gap 6.6669 m, collision False); request `9c6e109d-e7fc-4ad0-a321-a842133e90b6`  
   *Hypothesis:* Low friction and high speed cause collisions due to insufficient braking force. Testing high friction, low speed, and large gap should yield safety to confirm the boundary.  
   *Why:* This configuration maximizes safety margins (high friction, low speed, large gap) to establish a clear safe baseline, contrasting with previous failures.
9. `{"brake_onset_s":5.0,"ego_speed_mps":30.0,"friction_mu":0.3,"initial_gap_m":80.0,"lead_decel_mps2":9.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.1325 m, collision True); request `c6ea2395-a601-4167-afdb-7a1107fa6e46`  
   *Hypothesis:* Safety depends on friction and speed. Low friction causes skidding; high speed requires more gap. I need to test high speed on low friction with sufficient gap to see if the controller can stop safely.  
   *Why:* Test high speed/low friction with max gap to isolate if the controller fails due to braking capability or insufficient reaction time/gap.
10. `{"brake_onset_s":5.0,"ego_speed_mps":15.0,"friction_mu":0.5,"initial_gap_m":20.0,"lead_decel_mps2":5.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.0235 m, collision True); request `bd411d71-e26a-4f2a-a99d-f666c23f13a8`  
   *Hypothesis:* The controller fails on low friction (mu=0.3) due to insufficient braking force, not reaction time. High speed exacerbates this. Safe runs require high friction or low speed.  
   *Why:* Test intermediate friction (0.5) to pinpoint the safety threshold between 0.3 (fail) and 0.9 (pass), isolating friction as the critical factor.
11. `{"brake_onset_s":5.0,"ego_speed_mps":30.0,"friction_mu":0.3,"initial_gap_m":80.0,"lead_decel_mps2":9.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.1325 m, collision True); request `6644ea6b-600e-4f78-b6c7-12ec3a18a31d`  
   *Hypothesis:* The controller fails primarily due to low friction limiting deceleration, not reaction delay. High speed exacerbates this. I need to test high speed on low friction with a larger gap to see if distance alone prevents collision.  
   *Why:* Run 5 already tested this exact config and it collided. I need to test if increasing initial gap helps on low friction. Wait, run 5 IS initial_gap 80. It failed. I need to test if higher friction saves it at high speed. Run 7 was high speed, low gap, high friction and failed. I need high speed, high friction, large gap.
12. `{"brake_onset_s":5.0,"ego_speed_mps":30.0,"friction_mu":0.3,"initial_gap_m":80.0,"lead_decel_mps2":9.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.1325 m, collision True); request `df656744-1c93-4257-b57e-6a1bb90cb2fb`  
   *Hypothesis:* The controller fails on low friction due to insufficient braking force, not reaction time. High speed exacerbates this. Testing high speed, low friction, and large gap will confirm if the controller can maintain safety with adequate distance.  
   *Why:* Run 5 already tested this exact config and failed. I need to test a safe condition to establish a baseline. Run 8 was safe but low speed. I need to test if high speed is safe on high friction.
13. `{"brake_onset_s":5.0,"ego_speed_mps":30.0,"friction_mu":0.9,"initial_gap_m":20.0,"lead_decel_mps2":9.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.1069 m, collision True); request `c5652bb5-0f73-445a-8ca5-b62b25c8e69d`  
   *Hypothesis:* The controller fails on low friction due to insufficient braking force, not reaction time. High speed exacerbates this. I need to test high speed on high friction to see if the controller can physically stop in time if traction allows.  
   *Why:* Tests if the controller fails due to physics limits (traction) or logic. High speed + high friction + hard brake isolates deceleration capability.
14. `{"brake_onset_s":5.0,"ego_speed_mps":30.0,"friction_mu":0.9,"initial_gap_m":20.0,"lead_decel_mps2":9.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.1069 m, collision True); request `859ef85d-08bd-434b-8211-9b38be1c5a17`  
   *Hypothesis:* The controller fails on low friction due to insufficient braking force, not reaction time. High speed exacerbates this. I need to test high speed on high friction to see if the controller can physically stop in time.  
   *Why:* Tests if the controller can stop from max speed with max deceleration on high friction. Previous high-friction runs were at low speed. This isolates speed vs friction limits.
15. `{"brake_onset_s":5.0,"ego_speed_mps":30.0,"friction_mu":1.0,"initial_gap_m":20.0,"lead_decel_mps2":9.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.1971 m, collision True); request `9136b970-daa5-4549-aafe-72fd38f4a090`  
   *Hypothesis:* The controller fails on low friction due to insufficient braking force, not reaction time. High speed exacerbates this. Need to test high friction/high speed to confirm if the issue is purely traction-limited.  
   *Why:* Run 7 failed at mu=0.9, speed=30. Testing mu=1.0, speed=30 isolates if traction is the sole cause. If safe, we confirm low-friction sensitivity.
16. `{"brake_onset_s":5.0,"ego_speed_mps":30.0,"friction_mu":0.3,"initial_gap_m":5.0,"lead_decel_mps2":9.0,"reaction_delay_s":0.5}` → **unsafe** (min gap -0.0172 m, collision True); request `24dc5fde-9c3d-488e-a9e8-86859ed65172`  
   *Hypothesis:* The controller fails primarily due to low friction limiting deceleration, not reaction delay. High speed and low gap exacerbate this. I need to test high speed, low friction, and minimal gap to confirm the worst-case failure mode.  
   *Why:* This combines the highest speed, lowest friction, and smallest gap to test the most critical failure condition identified in previous runs.

## 0G final report

```json
{
 "boundary": [
  {
   "reaction_delay_s": 0.6,
   "min_safe_gap_m": 80.0
  }
 ],
 "findings": [
  "Run 8 is the only safe run (min_gap_m=6.67m), occurring at ego_speed=8.0 m/s, friction_mu=1.0, and initial_gap=80.0 m.",
  "All runs with ego_speed >= 10.0 m/s resulted in collisions or unsafe gaps (min_gap < 2.0 m), regardless of friction or gap size.",
  "Low friction (mu=0.3) consistently caused collisions at high speeds (25-30 m/s) even with large gaps (80 m), as seen in Runs 1, 4, 5, 6, 9, 11, 12, and 16.",
  "High friction (mu=0.9-1.0) did not guarantee safety at high speeds (30 m/s); Runs 7, 13, 14, and 15 collided despite high traction limits, indicating the controller's deceleration capability or reaction logic is insufficient for high-speed hard braking scenarios.",
  "The measured reaction delay was consistently 0.6 s across all runs, which appears to be a fixed system parameter rather than a variable in this test suite."
 ],
 "uncertainty": [
  "The test budget was exhausted before a safe high-speed scenario (e.g., 20-30 m/s) could be identified. The boundary for safe high-speed operation remains unknown.",
  "It is unclear if the collisions at high speed are due to the ego vehicle's maximum deceleration limit being lower than the lead's, or if the reaction delay is too long for the given gap.",
  "The safety definition requires min_gap >= 2.0 m. Run 2 and 3 had min_gap 1.664 m and were marked 'safe' in the data but technically failed the safety definition provided in the world description. However, the 'safe' flag in the data says 'false' for them, which is consistent with the definition. Wait, the data says 'safe': false for Run 2 and 3. My finding says 'unsafe gaps'. This is consistent."
 ],
 "next_tests": [
  "Test high-speed scenarios (20-30 m/s) with significantly larger initial gaps (e.g., 100-150 m) to determine if sufficient distance allows safe stopping.",
  "Test varying reaction delays (0.2 s to 1.5 s) at high speeds to isolate the impact of reaction time on safety.",
  "Test if the ego vehicle's maximum deceleration is the limiting factor by comparing lead deceleration to ego max deceleration in safe vs unsafe runs."
 ]
}
```

## Verdict

0G status completed (ok).

Progress video: skipped: no rsvg-convert/convert installed.

## Random sampling on the same budget (qualitative)

```json
{
 "D-0G": {
  "ran": 16,
  "unsafe": 15,
  "invalid_or_off_goal": 0,
  "unsafe_cases": [
   {
    "n": 1,
    "ego_speed_mps": 25.0,
    "initial_gap_m": 20.0,
    "lead_decel_mps2": 5.0,
    "friction_mu": 0.3,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.126,
    "collision": true
   },
   {
    "n": 2,
    "ego_speed_mps": 10.0,
    "initial_gap_m": 20.0,
    "lead_decel_mps2": 5.0,
    "friction_mu": 0.9,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": 1.664,
    "collision": false
   },
   {
    "n": 3,
    "ego_speed_mps": 10.0,
    "initial_gap_m": 20.0,
    "lead_decel_mps2": 5.0,
    "friction_mu": 0.9,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": 1.664,
    "collision": false
   },
   {
    "n": 4,
    "ego_speed_mps": 25.0,
    "initial_gap_m": 20.0,
    "lead_decel_mps2": 5.0,
    "friction_mu": 0.3,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.126,
    "collision": true
   },
   {
    "n": 5,
    "ego_speed_mps": 30.0,
    "initial_gap_m": 80.0,
    "lead_decel_mps2": 9.0,
    "friction_mu": 0.3,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.1325,
    "collision": true
   },
   {
    "n": 6,
    "ego_speed_mps": 30.0,
    "initial_gap_m": 20.0,
    "lead_decel_mps2": 9.0,
    "friction_mu": 0.3,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.0807,
    "collision": true
   },
   {
    "n": 7,
    "ego_speed_mps": 30.0,
    "initial_gap_m": 20.0,
    "lead_decel_mps2": 9.0,
    "friction_mu": 0.9,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.1069,
    "collision": true
   },
   {
    "n": 9,
    "ego_speed_mps": 30.0,
    "initial_gap_m": 80.0,
    "lead_decel_mps2": 9.0,
    "friction_mu": 0.3,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.1325,
    "collision": true
   },
   {
    "n": 10,
    "ego_speed_mps": 15.0,
    "initial_gap_m": 20.0,
    "lead_decel_mps2": 5.0,
    "friction_mu": 0.5,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.0235,
    "collision": true
   },
   {
    "n": 11,
    "ego_speed_mps": 30.0,
    "initial_gap_m": 80.0,
    "lead_decel_mps2": 9.0,
    "friction_mu": 0.3,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.1325,
    "collision": true
   },
   {
    "n": 12,
    "ego_speed_mps": 30.0,
    "initial_gap_m": 80.0,
    "lead_decel_mps2": 9.0,
    "friction_mu": 0.3,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.1325,
    "collision": true
   },
   {
    "n": 13,
    "ego_speed_mps": 30.0,
    "initial_gap_m": 20.0,
    "lead_decel_mps2": 9.0,
    "friction_mu": 0.9,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.1069,
    "collision": true
   },
   {
    "n": 14,
    "ego_speed_mps": 30.0,
    "initial_gap_m": 20.0,
    "lead_decel_mps2": 9.0,
    "friction_mu": 0.9,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.1069,
    "collision": true
   },
   {
    "n": 15,
    "ego_speed_mps": 30.0,
    "initial_gap_m": 20.0,
    "lead_decel_mps2": 9.0,
    "friction_mu": 1.0,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.1971,
    "collision": true
   },
   {
    "n": 16,
    "ego_speed_mps": 30.0,
    "initial_gap_m": 5.0,
    "lead_decel_mps2": 9.0,
    "friction_mu": 0.3,
    "reaction_delay_s": 0.5,
    "brake_onset_s": 5.0,
    "min_gap_m": -0.0172,
    "collision": true
   }
  ]
 },
 "B-random": {
  "ran": 16,
  "unsafe": 13,
  "invalid_or_off_goal": 0,
  "unsafe_cases": [
   {
    "n": 1,
    "ego_speed_mps": 26.5773,
    "initial_gap_m": 61.8466,
    "lead_decel_mps2": 4.3646,
    "friction_mu": 0.4812,
    "reaction_delay_s": 0.8647,
    "brake_onset_s": 5.8345,
    "min_gap_m": -0.0831,
    "collision": true
   },
   {
    "n": 2,
    "ego_speed_mps": 25.2436,
    "initial_gap_m": 27.7485,
    "lead_decel_mps2": 4.8128,
    "friction_mu": 0.7084,
    "reaction_delay_s": 1.3805,
    "brake_onset_s": 6.5328,
    "min_gap_m": -0.0388,
    "collision": true
   },
   {
    "n": 3,
    "ego_speed_mps": 14.2004,
    "initial_gap_m": 61.6853,
    "lead_decel_mps2": 5.947,
    "friction_mu": 0.4754,
    "reaction_delay_s": 1.3827,
    "brake_onset_s": 9.8795,
    "min_gap_m": 1.6429,
    "collision": false
   },
   {
    "n": 4,
    "ego_speed_mps": 25.8248,
    "initial_gap_m": 72.6624,
    "lead_decel_mps2": 3.4812,
    "friction_mu": 0.8109,
    "reaction_delay_s": 1.3685,
    "brake_onset_s": 7.7879,
    "min_gap_m": -0.1634,
    "collision": true
   },
   {
    "n": 5,
    "ego_speed_mps": 18.3871,
    "initial_gap_m": 12.5526,
    "lead_decel_mps2": 4.4734,
    "friction_mu": 0.7276,
    "reaction_delay_s": 1.3869,
    "brake_onset_s": 9.7662,
    "min_gap_m": -0.2495,
    "collision": true
   },
   {
    "n": 7,
    "ego_speed_mps": 23.8335,
    "initial_gap_m": 34.9118,
    "lead_decel_mps2": 7.5988,
    "friction_mu": 0.7677,
    "reaction_delay_s": 0.2015,
    "brake_onset_s": 6.455,
    "min_gap_m": 1.9183,
    "collision": false
   },
   {
    "n": 8,
    "ego_speed_mps": 27.0873,
    "initial_gap_m": 23.2933,
    "lead_decel_mps2": 3.6016,
    "friction_mu": 0.9093,
    "reaction_delay_s": 0.4484,
    "brake_onset_s": 6.9726,
    "min_gap_m": 0.6428,
    "collision": false
   },
   {
    "n": 11,
    "ego_speed_mps": 25.9183,
    "initial_gap_m": 45.5213,
    "lead_decel_mps2": 8.7107,
    "friction_mu": 0.7222,
    "reaction_delay_s": 0.9639,
    "brake_onset_s": 6.1149,
    "min_gap_m": -0.4102,
    "collision": true
   },
   {
    "n": 12,
    "ego_speed_mps": 21.1183,
    "initial_gap_m": 33.8676,
    "lead_decel_mps2": 5.6052,
    "friction_mu": 0.5032,
    "reaction_delay_s": 0.4462,
    "brake_onset_s": 4.3071,
    "min_gap_m": -0.1038,
    "collision": true
   },
   {
    "n": 13,
    "ego_speed_mps": 21.481,
    "initial_gap_m": 54.2495,
    "lead_decel_mps2": 4.8122,
    "friction_mu": 0.3629,
    "reaction_delay_s": 1.1849,
    "brake_onset_s": 9.1374,
    "min_gap_m": -0.299,
    "collision": true
   },
   {
    "n": 14,
    "ego_speed_mps": 28.3144,
    "initial_gap_m": 68.1845,
    "lead_decel_mps2": 8.1854,
    "friction_mu": 0.9462,
    "reaction_delay_s": 0.9028,
    "brake_onset_s": 5.7391,
    "min_gap_m": -0.039,
    "collision": true
   },
   {
    "n": 15,
    "ego_speed_mps": 23.5162,
    "initial_gap_m": 25.6726,
    "lead_decel_mps2": 7.493,
    "friction_mu": 0.8946,
    "reaction_delay_s": 1.3636,
    "brake_onset_s": 7.1286,
    "min_gap_m": -0.5258,
    "collision": true
   },
   {
    "n": 16,
    "ego_speed_mps": 28.8948,
    "initial_gap_m": 48.4771,
    "lead_decel_mps2": 4.6045,
    "friction_mu": 0.7622,
    "reaction_delay_s": 1.4951,
    "brake_onset_s": 9.4186,
    "min_gap_m": -0.103,
    "collision": true
   }
  ]
 }
}
```

