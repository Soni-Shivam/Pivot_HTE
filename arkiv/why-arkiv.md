# Why Arkiv

Faultline's safety claims ("idm-follower v1.1: 30 hard-brake tests, 0 collisions, 95 % CI [0, 11.4 %]") have to be
**readable by people who don't trust the tester or the OEM**, **filterable** (by model, version, category, rate), and
**owned** by the party making the claim. Arkiv gives all three without us running a server:

- **Owned, attributable rows.** Each claim entity's `$owner` is the OEM wallet; a reader filters with
  `ownedBy(oem)` and ignores anyone else writing the same schema tag. The same wallet owns ERC-8004 agent #579 and is
  the only address the Galileo registry accepts anchors from, so "who said this" is one key across both chains.
- **Queries, not blobs.** 0G Storage holds the evidence (sealed records, public summary) but you can't ask it "every
  v1.1 claim with a collision rate under 1 %". Arkiv's indexed attributes answer that directly from a static page.
- **Expiry that matches meaning.** A claim about one campaign should go stale (90 days); Arkiv expires it natively,
  while the permanent evidence stays on 0G + Galileo.
- **No backend.** The dashboard (`apps/memory-web`) reads Arkiv and Galileo straight from the browser (both RPCs answer
  CORS preflights with `*`). Nothing for us to host, patch or be trusted for.

What it would cost on Postgres: we would be the database operator. Readers would have to trust our rows, our
timestamps, our deletions, and our uptime; there would be no owner signature on a row, and an OEM couldn't take its
claims elsewhere.
