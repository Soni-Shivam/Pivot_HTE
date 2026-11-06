# eth_hackathon (working name SealedAI; the name is a placeholder)

For anything 0G, read and follow ./.0g-skills/CLAUDE.md (install it with `scripts/setup.sh` if missing).
Before touching 0G, sandbox/TAPP, ERC-8183, attestation or Arkiv code, read .claude/skills/sealedai-stack/SKILL.md.

## How work is tracked (this project is built by agents)
Read in order: `docs/PLAN.md` (scope, decisions) → `docs/SECURITY.md` (invariants I1–I12, allowed claims) →
`docs/PROTOCOL.md` (binding formats) → `docs/ARCHITECTURE.md` → `docs/TASKS.md` (tracker) →
`docs/THREE-DEVELOPER-EXECUTION.md` (parallel ownership) → the current plan in `docs/superpowers/plans/`.
- For three-person execution, take the first ready `todo` in your assigned lane in the ownership charter; otherwise
  take the first `todo` whose **Needs** are `done`. It's `done` only when every acceptance
  test passes and **Evidence** is filled (test summary line, tx hash, address, 0G root, request ID, entity key, digest).
- Don't contradict PLAN/SECURITY/PROTOCOL silently. If work shows a decision is wrong: stop, add a change-log line in
  TASKS, tell the user. Never mark T00 (scope approval) yourself.
- Write the next phase's step plan only after the current phase's exit check passes.

## Hard rules
- Reuse first, and never invent an API, field, address or behaviour: read it from docs, pinned source, or a live
  call, and cite where it came from.
- Nothing is "attested", "confidential" or "verified" without the evidence SECURITY.md requires. There is no mock
  mode: without verified TEE evidence, keys are never released. Synthetic data is for tests only (I12).
- Model weights and buyer rows never leave the enclave and never go to the 0G Router; the agent sees aggregates only (I9).
- The LLM never gets authority: no shell, network, files, signing, spending or key release (I5).
- Router calls are private-tier only; never fall back to another tier (I9). Never use the 0G Storage SDK's
  `encryption` option; use our AES-GCM envelope (I10).
- Never print, log or commit `.env` values. Node via `. ~/.nvm/nvm.sh` (Node 22). Exact dependency pins; `ethers`
  exactly `6.13.1`, imported only in the storage adapter.
- No backend server, analytics or trackers. Users' keys and data stay on their device.
- Ask the user before downloaded install scripts, any testnet spend, or anything outward-facing (push, post, publish).
- Smallest change that passes the task's acceptance tests (ponytail).
