# Arkiv friction log (what actually happened while building)

1. **MCP server unavailable.** `hub.arkiv.network/mcp` (our configured MCP URL) answered `405 Method Not Allowed`; the
   page said "MCP setup is temporarily unavailable". We used the SDK and the docs' `llms.txt` instead, which were good.
2. **Access key required in practice.** The public RPC is rate limited, so every user needs an access key from the
   Hub. For a static, backend-less app this means each user brings their own key (we can't ship ours in the bundle).
3. **`u64` values must be wrapped.** Writing `BigInt(Date.now())` into a `u64` column failed (`columnName: 'at'`): a
   bare bigint is a `u256`. The docs say this; the runtime error could name the expected constructor (`u64(...)`).
4. **Paging needs care.** `select` has `limit`/`offset` but no async iterator in 1.0.1; correct paging must add
   `skipped` to the offset. Easy to get subtly wrong — a helper that iterates all pages would help.
5. **Trusting reads is on the app.** Because anyone can write any schema tag, every read must filter or re-check
   `$creator`. The docs say so clearly; we added a full re-verification step (see `how-you-use-arkiv.md`).
6. **Separate chain, separate gas.** Writes need tGLM on Rabdi from the faucet, separately from 0G testnet gas, so
   onboarding a seller has two faucets.
