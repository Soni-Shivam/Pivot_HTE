# Faultline × Hedera x402 — paid policy stress tests

Status: **Design basis; local x402 and kinematic vertical slice implemented 2026-11-07.**
Prepared 2026-11-07 from the current Faultline architecture and Hedera's official x402 docs and ETHGlobal Mumbai
prize requirements. The implementation and testnet evidence are recorded in `docs/evidence/faultline-paid-job-001.md`.

## 1. Product proposition

An automotive company's agent can discover Faultline as a stress-testing service, purchase one bounded test run
with x402, and receive a replayable report. The company pays per accepted test job rather than arranging a manual
invoice or giving Faultline's agent open-ended access to a corporate wallet.

**User story:** “Run my approved policy against the cut-in and occlusion suites, with a maximum spend of $X. Return
the episode evidence and metrics. Do not upload my policy or allow the test to exceed this run's limits.”

## 2. Why Hedera x402 fits

- x402 gives an HTTP service a discrete request → payment → response handshake. Hedera's `exact` scheme settles a
  precise amount in HBAR or an HTS fungible token. A facilitator verifies and submits the transfer and pays network
  fees; the payer still authorizes the transfer and needs the asset. See the [Hedera overview](https://docs.hedera.com/solutions/ai/x402),
  [flow](https://docs.hedera.com/solutions/ai/x402/how-it-works), and [exact scheme](https://docs.hedera.com/solutions/ai/x402/exact-scheme).
- This maps naturally to one paid stress-test job. It is not a streaming meter or subscription; do not charge per
  simulator tick or treat a long-running simulation as one synchronous HTTP response.
- Hedera's Mumbai qualification requires a paid x402 endpoint, an agent/client that completes a payment
  end-to-end without human approval, a Hedera transaction ID, and a demo showing the settlement on HashScan. The
  prize gives extra credit for spend controls and an HCS spending audit. See the [official prize requirements](https://ethglobal.com/events/mumbai/prizes).

## 3. Proposed end-to-end flow

1. **Discover.** The buyer's agent reads a small Faultline service manifest describing supported test suites,
   required local runner version, price, accepted Hedera network/asset, and resource endpoint. Discovery is a
   Faultline-owned format unless we adopt a documented standard; it is not claimed to be an x402 feature.
2. **Set a bounded request.** The company configures an allowlisted suite, one policy commitment, a maximum run
   count, and a maximum total spend. The agent cannot change its merchant allowlist or spend cap.
3. **Request one job.** The agent calls `POST /v1/stress-tests` with the suite, runner version, policy commitment,
   and an idempotency key. The body contains no policy source, weights, customer identifiers, or raw scenario data.
4. **Price and pay.** The endpoint returns HTTP 402 with one exact price, `payTo`, supported Hedera network/token,
   `feePayer`, and timeout. The client verifies these fields against its merchant allowlist and configured budget,
   signs a transfer, then retries with the x402 payment payload.
5. **Accept exactly once.** The resource server verifies and settles through a Hedera facilitator. After confirmed
   settlement, it durably binds the transaction ID and idempotency key to one job, then returns a signed run permit
   and job ID. Duplicate retries return the same accepted job and never start a second paid run.
6. **Execute.** In the privacy-preserving first version, the company's Faultline runner executes the selected
   policy locally against CARLA and the 0G-driven adversarial actor. The policy and detailed observations stay in
   the company's environment. Only minimized observations needed for the 0G decision loop go to the 0G Router,
   under the current Faultline design.
7. **Publish evidence and retrieve.** The runner uploads the episode's public and sealed artifacts to 0G Storage,
   anchors commitments on 0G Galileo as currently designed, and returns the report and evidence roots using the
   run permit. Payment metadata is associated with the job, not copied into simulation prompts or public evidence.
8. **Show the receipt.** The demo displays the x402 settlement transaction on Hedera HashScan, the test job ID,
   0G request IDs, 0G Storage roots, the 0G Galileo commitment, and the replay/verification result.

## 4. Service boundary: scope choice required

The current Faultline spec says the SUT stays in the customer's environment, runs no server of ours, and lists
marketplace/payments as non-goals. The product should not silently violate those decisions. There are two possible
shapes:

### Recommended first integration: customer-side runner + paid entitlement

Faultline's x402 merchant endpoint sells a one-run authorization (and, if appropriate, a versioned test-suite
package). The customer's own runner applies it and performs the simulation locally. Faultline's service never
receives the customer's policy or raw scenario data. This preserves the SUT boundary and makes payment a clear
license for a bounded test job.

This still introduces a Faultline-operated x402 resource server and durable payment/job idempotency state. It is
therefore a real architecture change from “no backend server”; it needs an explicit scope decision before coding.

### Later option: hosted execution

Faultline accepts a remote company SUT endpoint or policy artifact and runs tests as a hosted service. This is a
larger product/security change: it changes where policy code and observations flow, creates tenant isolation and
credential risks, and may violate the existing promise that the SUT stays on the customer's side. Do not choose it
as a shortcut for the hackathon demo.

## 5. Proposed API and state model (Faultline-owned)

Initial candidate endpoints:

- `GET /.well-known/faultline-service.json` — discovery manifest and versioned service capabilities.
- `POST /v1/stress-tests` — x402-protected, fixed-price job acceptance. A paid request buys one job, not an
  unbounded balance.
- `GET /v1/stress-tests/{jobId}` — job state and completion receipt, authorized by the opaque run permit; no
  second payment for polling.
- `GET /v1/stress-tests/{jobId}/report` — report/evidence references after completion; access bound to the run
  permit. The response can link to 0G artifacts without exposing a tenant key.

Keep payment and execution state distinct:

```text
payment: 402_issued → settled → bound_to_job
job:     accepted → running → completed | interrupted | failed_before_start
```

The run permit should bind at minimum to `jobId`, buyer account, test-suite/version, policy commitment, max-run
budget, expiry, and the payment transaction ID. It must not contain a private key or confer authority to spend.

## 6. Reliability, privacy, and safety requirements

- **No charge-per-tick:** price a complete bounded test job. x402's Hedera scheme is stateless and per-request;
  each additional paid action must be an explicit request.
- **Idempotency:** persist `(merchant, payer, idempotencyKey, requestHash, paymentTxId, jobId)` before acknowledging
  the paid request. A replay or network retry must not create another job. Reject reuse of an idempotency key with
  a different request hash.
- **No free execution on invalid payment:** validate scheme, Hedera network, asset, exact amount, destination,
  timeout, payer, facilitator result, and settlement before creating an executable permit.
- **No payment authority for the LLM:** the Faultline model proposes driving actions only. A deterministic client
  policy enforces merchant allowlists, budgets, suite limits, and all signing. The agent's key is scoped to the
  permitted payment flow and is never given to the model.
- **Fail closed:** payment settlement failure creates no job; Router failure triggers the existing safe-halt
  state; an interrupted paid job is reported honestly and is never converted to a successful result.
- **Refund policy:** x402 has no built-in streaming or job-refund lifecycle. Before implementation, define whether a
  payment is earned at accepted job creation or whether a pre-start system failure receives a separate merchant
  refund. Do not imply automatic refunds.
- **Data minimization:** do not put policy, scenario, report, 0G keys, or buyer identity in Hedera calldata,
  transaction memos, x402 resource descriptions, or HCS. Public payment accounts and amounts are visible on
  Hedera; the customer needs to accept that metadata exposure.
- **No unsupported verification claim:** Hedera payment proves a transfer settled. It does not prove CARLA's
  physics, the policy's quality, the 0G decision content, or the truth of the report. Keep those claims tied to
  Faultline's 0G evidence and replay checks.
- **Facilitator:** official Hedera docs currently list the public x402 facilitator for testnet quickstarts and
  name other providers. Query `/supported` at setup/runtime and confirm the selected facilitator advertises
  `hedera:testnet`; don't bake an assumed fee-payer address into product code. Production requires a facilitator
  advertising mainnet and a separate operational review.

## 7. Hackathon vertical slice

For a credible demo, implement only:

1. One discoverable Faultline stress-test service and one fixed-price suite.
2. One x402-protected job-acceptance endpoint on Hedera testnet.
3. One company-side client/agent that reads the service manifest, checks its configured spend cap, pays the 402,
   and receives a single-use run permit without human approval.
4. One real Faultline local run bound to that permit, with 0G decisions, safe-halt behavior, 0G Storage evidence,
   and the existing Galileo anchoring.
5. One end-to-end evidence record: Hedera transaction ID + HashScan link, job/permit identifiers, 0G request IDs,
   Storage roots, Galileo transaction hashes, and replay verification.

Do not add multiple assets, subscription billing, tokenization, escrow, an open evaluator marketplace, or a custom
facilitator to the first slice. Consider HCS spending audit and Hedera Agent Kit integration only after the paid
request and local run path work; the ledger transaction already gives the required settlement evidence.

## 8. Acceptance criteria before calling it complete

- A buyer agent discovers the supported service and rejects an unknown merchant, unsupported network/token, price
  above its cap, malformed requirements, or expired payment request without signing.
- One valid x402 request settles on Hedera testnet; the response binds to the actual settlement transaction and
  returns one run permit.
- Duplicate same-key requests return the same job; altered-body reuse is rejected; failed settlement starts no run.
- The paid permit authorizes one run only; expired, reused, wrong-suite, wrong-policy-commitment, and over-budget
  permits are rejected.
- The local SUT/policy does not appear in the merchant request, Hedera transaction, public bundle, or 0G Router
  prompt. Verify by inspecting the actual serialized artifacts.
- The run finishes or safely interrupts. Its report distinguishes completed/interrupted/failed and has replayable
  0G evidence. A 0G failure never becomes a successful paid run.
- The demo shows the complete 402 → signed payment → facilitator settlement → job acceptance → run → report flow,
  with the Hedera transaction visible on HashScan and the 0G evidence independently inspectable.
- README documents setup, architecture, asset/network, facilitator, price, payment flow, trust boundaries, and the
  testnet transaction ID.

## 9. Official references checked

- [About x402 on Hedera](https://docs.hedera.com/solutions/ai/x402)
- [How x402 works](https://docs.hedera.com/solutions/ai/x402/how-it-works)
- [Accept x402 (resource server)](https://docs.hedera.com/solutions/ai/x402/merchant-integration)
- [Pay with x402](https://docs.hedera.com/solutions/ai/x402/pay-with-x402)
- [Facilitators](https://docs.hedera.com/solutions/ai/x402/facilitators)
- [Hedera exact scheme](https://docs.hedera.com/solutions/ai/x402/exact-scheme)
- [ETHGlobal Mumbai Hedera prizes](https://ethglobal.com/events/mumbai/prizes)

