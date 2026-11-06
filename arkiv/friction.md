# Arkiv friction log (what actually happened while building)

Faultline safety claims (2026-11-07):
1. **MCP server still unavailable.** The configured Arkiv MCP endpoint failed to connect again (`405 Method Not
   Allowed`). We used the SDK source in `node_modules/@arkiv-network/sdk` and its README instead.
2. **Two ways to send the access key.** The SDK's `rabdi({ accessKey })` puts the key in the RPC URL path (the source
   comment says it "is not a secret"); our project rule sends it as an `X-API-KEY` header so it never shows up in a
   logged URL. That needed a custom viem transport (`http(url, { fetchOptions: { headers } })`); a documented header
   option on `rabdi()` would be simpler.
3. **CORS works (good).** The RPC answers preflights with `Access-Control-Allow-Origin: *` and allows `X-Api-Key`, so
   the static dashboard reads Arkiv from the browser with no proxy. The keyless public endpoint is rate-limited; the
   page lets a viewer paste their own key.
4. **`dec` takes strings only.** Rates are floats in our pipeline; we had to format them (`toFixed(6)`) before
   `dec(...)`. Sensible (no silent rounding), but a numeric overload with an explicit scale would help.
5. **Typed `where` vs dynamic filters.** Building a filter list at runtime (model/version/category chosen in the UI)
   fights the schema-checked `where` types; we cast the expression. A typed helper for optional filters would help.
6. **Trust is on the reader.** Anyone can write `faultline.claim/v1`; every reader must filter `ownedBy(oem)` and,
   ideally, cross-check `public_root` against the Galileo anchor (the dashboard does both).
7. **Separate chain, separate gas.** Writing claims needs tGLM on Rabdi in addition to 0G gas for anchoring.

Earlier (SealedAI catalog, 2026-11-06): bare `bigint` into a `u64` column fails (wrap with `u64()`); paging needs
`skipped` added to the offset.
