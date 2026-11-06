# Reach

**Who reads the claims**
- **OEMs / AV software teams** publish per-release safety claims for each controller version and compare releases
  ("did v1.1 fix the v1.0 cut-in collisions? did it regress low-friction?").
- **Insurers and fleet buyers** filter claims by model, version and category (and sample size) to price or accept a
  release, without getting the OEM's trajectories or configs.
- **Auditors / regulators** pick a claim, follow its `public_root` / `sealed_root` / `anchor_tx`, and, with the key the
  OEM hands them, recompute every number from the sealed records (`npm run memory -- verify`).

**What Arkiv makes possible for them:** a public, owner-signed, filterable list of safety claims that any front end can
read from a static page, tied to permanent evidence on 0G Storage and an owner-only anchor on 0G Galileo.

**Growth path:** more categories and scenario families (cut-in, occlusion, multi-agent swarm from the CARLA runs),
more models (`pdm-lite-lidar`), and third-party testers each writing claims under their own wallet and ERC-8004 id so
readers can compare testers, not just models.

**Today (testnet):** one OEM wallet, one model (`idm-follower`), two versions, four categories, 8 claim entities from
one regression campaign (see `how-you-use-arkiv.md`).
