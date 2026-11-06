# eth_hackathon (working name SealedAI; the name is a placeholder)

For anything 0G, read and follow ./.0g-skills/CLAUDE.md.
Before touching 0G, AgentDNA, ERC-8004/7857/8183, attestation or Arkiv code, read .claude/skills/sealedai-stack/SKILL.md.

## How work is tracked (this project is built by agents)
- `docs/PLAN.md` is the spec and the decision record. Don't contradict it silently: if work shows a decision is
  wrong, stop, add a change-log line in `docs/TASKS.md`, and tell the user.
- `docs/TASKS.md` is the live tracker. Take the first `todo` whose `Needs` are `done`, mark it `doing`, and finish
  by filling **Evidence** (tx hash, address, storage root, request ID, Arkiv entity key, agentId, or a test command
  plus its passing line). No evidence, not done.
- Step-by-step plans live in `docs/superpowers/plans/`. Write the next phase's plan only after the current phase's
  exit check passes.

## Hard rules
- Reuse first. Before writing a component, check PLAN §2 and the official docs/SDKs for an existing one. Never
  invent an API, field or address: read it from docs, source, or a live call, and cite where it came from.
- Nothing is called "attested", "confidential" or "verified" unless real evidence backs it. Local mocks say MOCK.
- Never print, log or commit `.env` values. Node via `. ~/.nvm/nvm.sh` (Node 22). `ethers` stays exactly `6.13.1`.
- No backend server, no analytics, no trackers (CROPS). Users' keys and data stay on their device.
- Stop AgentDNA containers when you're done with them (they bill per minute).
- Ask the user before running downloaded install scripts, spending more than 0.5 testnet 0G in one task, or doing
  anything outward-facing (posting, publishing, pushing).
- Keep changes small (ponytail style): the least code that meets the task's exit check.
