# How we use Arkiv

Arkiv is Faultline's **shareable safety-claims layer**: one `faultline.claim/v1` entity per (model, version, category,
campaign), written by the model owner's (OEM's) wallet and read by anyone from a static page. Schema:
[`schema.md`](schema.md).

**Writer wallet (OEM):** `0x8dac3a1fd3D7796254b84Ad70750430f67871069` on Rabdi (chain 7794095). The same wallet owns
ERC-8004 agent #579 on 0G Galileo and is the only address `AgentMemoryRegistry`
(`0x7a8676D267f1aa17d6B55cF5BfcD2A9509b963e3`) accepts anchors from for that agent.

**Users and what they do**
- **OEMs** publish a claim per category after each regression campaign (`npm run memory -- arkiv-publish <snapDir>`),
  e.g. v1.0 → v1.1 of `idm-follower`.
- **Insurers / fleet buyers** filter by model, version, category and sample size from the dashboard
  (`apps/memory-web`, `npm run mweb:build && npm run mweb:serve`) without seeing trajectories.
- **Auditors** follow a claim's `public_root`, `sealed_root` and `anchor_tx`; with the key the OEM gives them they
  recompute every n and rate from the sealed records (`npm run memory -- verify <publicRoot> <sealedRoot>`).

**Write path.** `faultline/regression.py` produces a snapshot (claims computed from the private records) →
`packages/memory` seals it and uploads public + sealed to 0G Storage → anchors the roots on Galileo → writes one Arkiv
entity per claim with the roots, the anchor tx and the per-claim records Merkle root, expiring after 90 days.

**Read path.** The dashboard queries Arkiv from the browser (`ownedBy(OEM)`, optional `model_id`/`version`/`category`
filters), reads the anchors from Galileo, and marks each claim ✓ only if its `public_root` equals the anchor's public
root for that sequence number; it also checks the anchor chain (`prevRoot` = previous sealed root) and that the
anchoring wallet is the live ERC-8004 owner.

**Runnable query** (Node, from the repo root; `.env` has `ARKIV_RPC_URL` and `ARKIV_API_KEY`):
```
npm run memory -- arkiv-query --model idm-follower --version 1.1 --owner 0x8dac3a1fd3D7796254b84Ad70750430f67871069
```
which runs `select … from faultline.claim/v1 where model_id = "idm-follower" and version = "1.1"` owned by the OEM
and returned (2026-11-07) four entities: low_friction 1/11 collisions (9.1 %), slow_reaction 2/27 (7.4 %),
hard_brake 0/30, lead_brake 0/67. Entity keys are listed in
[`docs/evidence/faultline-memory.md`](../docs/evidence/faultline-memory.md).

**What stays off Arkiv:** trajectories, scenario configs, per-test parameters, fingerprints per test, hypotheses and
the full record history. Those are in the sealed snapshot on 0G Storage (AES-256-GCM, key =
HKDF(tenant key, "memory:" + memory version)); Arkiv only carries the aggregates and the roots that bind them.

**What we'd lose on Postgres:** owner-attributed rows (a reader would trust our database instead of the OEM's
signature), portability (the OEM's claims would live in our tables), native expiry tied to the claim's meaning, and a
backend-free dashboard (we would have to run, secure and keep up an API server).

Earlier use (SealedAI phase, 2026-11-06): a model-listing catalog (`sealedai.listing/v1`, `examples/11-arkiv-catalog.ts`).
