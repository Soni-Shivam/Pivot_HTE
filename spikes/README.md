# Spikes (throwaway, 2026-11-07)

Scripts run once to learn the APIs before the build; results are in
`docs/superpowers/specs/2026-11-06-faultline-0g-architecture-design.md` §2.1. Not product code, no tests.

- `t2_probe.py`, `t5_tee.py`: first private-tier decisions on 0GM / GLM-5.3 / Laya; trace headers. `.venv/bin/python -I spikes/t2_probe.py`
- `verify-sdk.mjs`: `processResponse(provider, ZG-Res-Key)` with the Compute SDK (run inside a dir with `@0gfoundation/0g-compute-ts-sdk@0.9.0 ethers@6.13.1 crypto-js@4.2.0 circomlibjs@0.1.7` installed).
- `carla_spike.py`, `carla_spike2.py`: CARLA 0.10 staging, LiDAR corridor, recorder; road speed limits. Need the server:
  `cd ~/carla/Carla-0.10.0-Linux-Shipping && ./CarlaUnreal.sh -RenderOffScreen -quality-level=Low -nosound`
