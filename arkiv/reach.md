# Reach

**Who uses the catalog:** individuals and small teams who want to adapt an existing AI model to their own private
data (support triage, document routing, moderation, domain classification) without handing that data to the model's
owner, and model builders who want to license weights without ever shipping them.

**What Arkiv makes possible for them:** a public, censorship-resistant shop window that anyone can read from a static
page, where every listing is provably written by its seller and expires on its own. Any other front end can read the
same `sealedai.listing/v1` entities and apply the same checks (`$creator == seller`, signed offer on 0G Storage), so
the catalog isn't tied to our site.

**Growth path:** more categories and task types (the schema already carries `task` and `architecture`), opt-in
buyer-reported scores (`sealedai.score/v1`) linked to worker-signed receipts, and personal leaderboards built from a
buyer's own completed jobs.

**Today (testnet):** one seller wallet, one live listing, and one impostor listing used to prove the spoof check
(see `how-you-use-arkiv.md`).
