# Scenario clips (illustrative, scripted; not 0G-driven)

All five: CARLA 0.10.0 Town10HD_Opt, 1920x1080, 20 fps rendered in sim time (sync mode, dt 0.05), 11 s, made by
`scripts/clips/make_clips.py <name> <out>`. Vehicles are physics-driven by a scripted pure-pursuit + throttle/brake
controller (ego uses a simple IDM follower); no 0G call, no PDM-Lite. Each clip is labelled "CARLA 0.10 · scripted scenario".

- `lead-brake`: ego follows a red car on road 7; at 4 s the lead brakes fully, the ego's IDM brakes and stops behind it. Chase camera. Scripted.
- `cut-in`: an orange car in the left lane overtakes and cuts sharply into the ego lane ~5 m ahead, then slows; the ego brakes. Chase camera. Scripted.
- `pedestrian`: a delivery van and a truck stand at the kerb; a pedestrian steps out of the gap between them into the ego's lane and freezes; the ego brakes hard and stops ~1.4 m short. Walker position is scripted with set_transform (WalkerControl moves walkers at ~0.1 m/s on this build). Scripted.
- `lidar-dropout`: split frame, chase camera | ego LiDAR bird's-eye (real ray-cast LiDAR points). From 4.5 s to 5.6 s the obstacle's azimuth sector is blacked out (as in faultline/occlusion.py); the follower, reacting only to what it sees, keeps speed and then brakes hard when points return. Scripted.
- `intersection`: T-junction 23; a red SUV pulls out of the side street late and fast, turning across the ego's path; the ego brakes hard and stops ~1.5 m from its side. Fixed high 3/4 camera. Scripted.
