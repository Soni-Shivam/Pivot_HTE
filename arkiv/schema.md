# Arkiv schema (Faultline)

Defined in [`packages/memory/src/core.ts`](../packages/memory/src/core.ts) (`ClaimV1`) with `@arkiv-network/sdk` 1.0.1
on the Rabdi testnet (chain 7794095). Writer = the model owner's (OEM's) wallet
`0x8dac3a1fd3D7796254b84Ad70750430f67871069` (the `PRIVATE_KEY` wallet, which also owns ERC-8004 agent #579 on 0G
Galileo). Only **aggregate, shareable** claims go to Arkiv; trajectories, configs, per-test parameters and the full
record history are sealed (AES-256-GCM) on 0G Storage.

## `faultline.claim/v1` — one safety claim per (model, version, category, campaign)

| Column | Type | Indexed | Meaning |
|---|---|---|---|
| `model_id` | str | ✓ | e.g. `idm-follower` |
| `version` | str | ✓ | e.g. `1.0`, `1.1` |
| `category` | str | ✓ | `low_friction` (μ < 0.5), `slow_reaction` (delay ≥ 1 s), `hard_brake` (lead ≥ 6 m/s²), `lead_brake` (rest); first match wins |
| `agent_id` | u64 | ✓ | ERC-8004 agent id of the tester (579) |
| `campaign` | str | ✓ | memory version of the snapshot the claim comes from, e.g. `idm-follower@1.1#2` |
| `n_tests` | u64 | ✓ | tests in this category for this version |
| `n_collisions` | u64 | | collisions among them |
| `rate` | dec | ✓ | collision rate `n_collisions / n_tests` (6 dp) |
| `ci95_lo`, `ci95_hi` | dec | | Wilson 95 % interval of `rate` |
| `n_unsafe` | u64 | | unsafe = collision OR min gap < 2 m |
| `unsafe_rate` | dec | ✓ | `n_unsafe / n_tests` |
| `mean_speed_mps` | dec | | efficiency: mean ego speed over the runs |
| `artifact_digest` | str | | sha256 of the controller params + source (the model artifact tested) |
| `public_root` | str | ✓ | 0G Storage root of the public summary JSON |
| `sealed_root` | str | | 0G Storage root of the sealed snapshot (records + snapshot) |
| `claims_root` | str | | Merkle root over all claim lines of the snapshot (anchored on Galileo) |
| `records_merkle_root` | str | | Merkle root over this claim's records (auditor recomputes it from the sealed snapshot) |
| `registry` | addr | | AgentMemoryRegistry on Galileo (`0x7a8676D267f1aa17d6B55cF5BfcD2A9509b963e3`) |
| `anchor_seq` | u64 | | per-(agent, model) sequence of the anchor |
| `anchor_tx` | str | | Galileo tx of the anchor |

Indexed columns are exactly the ones people filter on: model, version, category, campaign, sample size, rates, and the
public root (to find every claim of one published snapshot).

**Expiration: 90 days.** A regression claim is a statement about one model version on one campaign; a release cycle /
quarterly re-test is the natural shelf life, after which a stale claim should disappear from queries rather than be
read as current. The evidence does not expire: the anchor on Galileo and the roots on 0G Storage are permanent, so an
expired claim can always be re-derived and re-published.

Merkle scheme (same in Python and TS): `record_hash = sha256(raw JSONL line)`, `parent = sha256(0x01‖l‖r)`, odd node
carried up, empty = `sha256("")`. Raw bytes only; JSON is never re-serialized across languages.
