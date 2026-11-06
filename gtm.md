# Is a marketplace the right thing to build? And the GTM if we go ahead

Follows `validation.md`. Evidence grades as before: **A** primary/vendor/press fact, **B** credible secondary,
**C** weak/aggregator. Where something is my reasoning rather than evidence, it says **(hypothesis)**. Hypotheses
are what the interviews in §7 must confirm or kill.

---

## 1. Short answer

**Not as the starting product.** A marketplace is the *end state* if this works, not the first thing to ship.
The evidence says the deals this tech enables are high-trust, negotiated, few-and-large, which is the opposite of
what an open marketplace is good at. The version worth building first is a **sealed trial**: one seller, one buyer,
one verified evaluation, one signed receipt. A catalog and a take-rate come afterwards if the trials repeat.

Why this isn't just hedging: every analogue I found that actually moved money was **bilateral, consortium or
tool-shaped**, not an open marketplace (§2).

---

## 2. What the analogues say about form factor

| Analogue | Shape | What it tells us | Grade |
|---|---|---|---|
| **MELLODDY** (10 pharma firms, €18M, 2.6B confidential data points, federated; ran 2019–22) | Closed consortium with a platform | Cross-company "compute meets private data" **works technically** and improved every partner's model (median +5.5% conformal efficiency) ([tech.eu](https://tech.eu/2022/07/13/eu-backed-healthcare-project-rolls-out-platform-for-federated-learning-in-drug-discovery/), [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11005050/)). But it was funded as a consortium with named, pre-agreed members, not discovered on a marketplace. | **A** (project facts) |
| **Data clean rooms** (Snowflake, AWS, Databricks, LiveRamp…) | Feature of an existing platform where both parties already are | Started in advertising where both sides already had a platform relationship, and is expanding slowly; adoption still short of analyst targets ([Decentriq comparison](https://www.decentriq.com/article/data-clean-rooms-compared), [market summary](https://www.dialectica.io/community-hub/the-rise-of-first-party-data-and-clean-rooms-market-trends-and-enterprise-adoption-in-2025)). Distribution came from the host platform, not from a neutral marketplace. | **B/C** |
| **Opaque Systems** (confidential AI platform, $31.6M raised) | Enterprise software sold to one organisation at a time | Customers named include ServiceNow, Encore Capital and the EU ([directory listing](https://komo.ai/directory/opaque-systems)). It sells confidential AI as a product to the *data owner*, not a two-sided network. | **C** (directory, unverified) |
| **Bank vendor onboarding** (credit scores, fraud models) | Bilateral procurement | The bank back-tests the vendor's model on its own portfolio *before* signing. Conventional vendor evaluation takes 12–18 months; disputes cluster on indemnification, data residency and model change control ([ProgressSoft](https://www.progressoft.com/blogs/beyond-the-pitch-a-framework-for-evaluating-ai-solutions-in-banking), [vendor onboarding chapter](https://mikenguyen13.github.io/credit_score/chapters/34b-vendor-onboarding-backtest.html)). SR 11-7 applies to vendor models ([summary](https://www.proofpoint.com/jp/legal/trust/banking-organizations-and-validation-of-vendor-and-other-third-party-products-under-sr-letter-11-7)). | **B/C** |
| **Hugging Face** | Open hub that monetizes enterprise governance, not seller revenue | The marketplace-shaped winner earns from private repos/endpoints, not from brokering paid models ([Sacra](https://sacra.com/chat/h/f1b08238-e0bc-4f76-9862-82f01168e321/)). | **C** |

**Reading:** the pain is real in one specific place, the **vendor back-test**: the buyer must test someone else's
model on its own data before buying, and neither wants to hand over the asset. That moment is a *transaction
inside a procurement process*, not a browse-and-click purchase. A marketplace listing page doesn't help with
indemnification, residency or change control; a verified, repeatable trial can speed up the part that *is* about
trust in the runtime.

**What a marketplace would still be good for (later):** discovery of models that already carry verified receipts.
That only has value once receipts exist. So receipts first.

---

## 3. The four shapes we could build

| | A. Open marketplace (current plan) | B. Buyer-side "sealed bake-off" | C. Seller-side "sealed trial link" | D. Consortium platform (MELLODDY-like) |
|---|---|---|---|---|
| Who we recruit first | Both sides at once | Buyers running vendor selection | Sellers who already have prospects | A group of peers pre-committed |
| Cold start | Worst (two empty sides) | Medium: needs vendors to join | **Best:** seller brings the buyer | Slow, relationship-heavy |
| Who pays | Take-rate (needs volume) | Buyer per bake-off | **Seller per trial** (replaces on-prem/PoC cost) | Members/grant |
| Build size | Largest | Medium | **Smallest** (evaluate-only) | Large |
| Fits a hackathon demo | Poor (empty catalog) | OK | **Good** (one live trial) | Poor |
| Becomes a marketplace later? | n/a | Yes (buyers pull vendors) | **Yes** (trial links accumulate into a verified-receipt directory) | Unlikely |
| Main risk | No supply, no demand | Buyers don't have a budget line for it | Sellers won't trust a third-party enclave | Needs an anchor sponsor |

**Recommendation: C first, grow into B, then open the catalog.** Reasoning **(hypothesis)**:
- The seller has the sales motion, the prospects and a reason to lower friction (their 12–18 month PoC is a cost
  to *them*). They are the hard side to recruit but they bring the other side with them.
- Single-player-mode ("come for the tool, stay for the network") is the most common GTM among the largest
  marketplaces; one analysis of the top 100 found it in 34% and reported ~10× the capital efficiency of
  "fill empty seats" launches ([Aakash Gupta summary](https://www.aakashg.com/marketplace-growth-strategies/),
  grade **C**: secondary write-up of someone else's analysis, so treat the figures as indicative).
  Our "tool" is: *prove my model's performance on your data without either side exposing anything.*
- Each completed trial leaves a signed receipt, which is the supply-side asset the future catalog is built from.

---

## 4. Beachhead: pick one, with reasons

| Segment | Why it could work | Why it might not | Grade |
|---|---|---|---|
| **Fintech model vendors → banks** (credit, fraud, AML scoring) | Back-test on the bank's own data is already a standard step; SR 11-7 expects validation; long procurement is a known pain | Banks' security/legal won't approve a new enclave vendor quickly; may demand SOC 2, indemnity, a US cloud | B/C |
| **Healthcare/biotech model builders → hospitals, labs** | Data can't leave; weights are the seller's asset (MELLODDY shows cross-party value) | HIPAA/IRB process; slow; big data owners are rare in our network | B |
| **Crypto-native** (on-chain risk/fraud/agent models → DAOs, protocols, exchanges) | Reachable at the hackathon, comfortable with wallets/escrow, fast decisions | Small budgets; many would just run the model themselves; weakest evidence of data that truly can't leave | **Hypothesis only** |
| **AI startups selling to enterprises** who need a "try it on our data" step | Large population; both sides are tech-literate | Enterprises already get this via a VPC deploy (§3.3 of validation.md) | C |

**Suggested path:** use crypto-native / dev-tool friendly design partners for the *first live trial* (fast, in the
hackathon window), but aim the story and the interviews at **fintech vendors → banks**, because that's where
the evidence shows a named, recurring, paid-for step. If the interviews in §7 don't confirm it, fall back to
healthcare, not to a generic marketplace.

---

## 5. The offer and the money

**Product (hypothesis):** a *sealed trial* in three clicks.
1. Seller creates a trial: model sealed to 0G Storage, an Offer naming the task, metrics, hardware/runtime policy,
   price and expiry. Gets a shareable link.
2. Buyer opens the link, their own client verifies the worker's hardware evidence, releases the dataset key.
3. The worker computes **aggregate** metrics only (accuracy, F1, a score the seller pre-declared), signs a receipt.
   Escrow pays the trial fee. Buyer gets the report; seller gets the receipt and a sales lead.

**Pricing options to test:**

| Model | Who pays | Pros | Cons |
|---|---|---|---|
| Per-trial fee | Seller (or buyer) | Matches the value of a skipped PoC; easy to explain | Low volume per customer |
| Compute pass-through + fee | Buyer | Honest cost; simple | Buyer sees a bill for a "trial" |
| Success fee on a signed licence | Seller | High value per deal | Needs a licence-signing flow and long cycles |
| Subscription for a verified-receipt directory | Seller | Recurring | Only after receipts exist |

Start with **per-trial, seller-paid**, and keep escrow for the *trial*, not for licences. Licences come in v2.

---

## 6. GTM plan

### 6.1 Positioning (what we say)
> "Show your model to a prospect on *their* data without shipping it, and let them check the hardware themselves."
Never "marketplace", never "private" without naming the hardware limits (`validation.md` §5).

### 6.2 Phases

| Phase | When | Goal | What we do | Exit gate |
|---|---|---|---|---|
| **0. Hackathon** | 6–8 Nov | One real, verified trial + an honest threat-model slide | Evaluate-only slice on whichever hardware you can actually provision; seller + buyer are two teammates or two friendly teams, *with a model that isn't public* | Receipt verifies independently; every failure mode (wrong image, replay, stale quote) fails closed |
| **1. Design partners** | Weeks 1–4 | 3 sellers each run ≥1 trial with a real prospect | Interview + hand-hold; build only what blocks a trial | ≥3 trials with a *buyer outside our friends*; seller says they'd pay |
| **2. Repeat** | Weeks 5–12 | Same seller runs a second trial unprompted | Templates for metrics; evidence verifier hardened; first compliance one-pager (data flow, hardware limits) | ≥2 sellers with repeat trials; ≥1 buyer evaluates a second vendor |
| **3. Directory** | After repeat | Catalog of models with verified receipts on Arkiv | Public receipts only (scores buyer-reported, salted commitments) | Buyers arrive *without* a seller link |
| **4. Licence + hosting** | Later | Take-rate on licence deals; hosted inference | Add escrow-to-licence and the training step *if* sellers ask | Demand-pulled, not roadmap-pushed |

The training step and the agent are **phase 4 features** unless the interviews say buyers need tuning more than scoring.

### 6.3 Channels (hypothesis)
- **Seller-led:** every trial link is the distribution. The seller shares it in their own outreach.
- **Direct outreach to ~30 fintech/health model vendors** with one concrete ask: "run one trial on a prospect of
  yours, we'll do the setup".
- **Hackathon/ecosystem:** 0G, Arkiv and EF mentors as the first buyers/sellers; the sponsors' own developer
  communities as seeds. Low-evidence for revenue, high-evidence for speed.
- **Content:** a short public "threat model and what we don't protect" page. The security-literate buyer will trust a
  vendor who states TEE.fail upfront more than one who hides it.

### 6.4 Trust and compliance (the real sales blocker, based on §2's bank row)
Prepare early, in this order: a one-page data-flow diagram; a plain list of what depends on hardware vendors vs
cryptography; the provider/hardware identity in the Offer so a buyer can refuse hosts; an exit path (refund after
expiry needs only RPC + contract, which your plan already has). SOC 2 / indemnity are phase-2 problems, but ask
every design partner which they'd require, because that determines whether banks are reachable at all.

---

## 7. What to test first (these decide the strategy)

| Hypothesis | Test | Kill / pivot if |
|---|---|---|
| H1. Sellers feel pain at the "try it on your data" step | 8 interviews with fintech/health model vendors: "How do prospects test you today? What does it cost you? How many deals stall there?" | Fewer than 3 call it a top-3 problem → don't build; reconsider |
| H2. Sellers will put weights in a third-party enclave | Same interviews: "Under what proof?" | Everyone needs indemnity/legal terms we can't give → seller-hosted verifier model (we ship the verifier, they host) |
| H3. Buyers will run a sealed trial on a real data sample | 5 buyer-side calls (bank/hospital data or analytics leads) | They require their own cloud → pivot to *runs in buyer's cloud confidential VM* mode |
| H4. Seller pays per trial | Offer a price in the interview ("$X per trial, would you sign today?") | Zero price acceptance → free tool + paid directory later, or stop |
| H5. Trials repeat | After 1st trial: "Would you do another next month?" | One-and-done → it's a service, not a product |

Track from day one: trials started, trials completed, time from link sent to receipt, % buyers who verify
independently, seller repeat rate, buyers who ask about a second vendor.

---

## 8. Risks to the GTM (not covered above)

- **Incumbent response:** a hyperscaler or clean-room vendor can ship "evaluate a vendor model on my data"
  inside its own platform (Snowflake/AWS already host clean rooms). Our defence is neutrality: neither party has to
  be on that platform. That only matters if the buyer and seller are on different clouds **(hypothesis)**.
- **Hardware trust:** see `validation.md` §5. It is the first question a serious buyer's security team asks.
- **Crypto friction:** escrow in a wallet may be a non-starter for banks. Plan a fiat-invoice mode for the
  trial fee later; keep the on-chain receipt for the audit trail.
- **Sponsor-driven scope:** the 0G Private Computer agent and Arkiv catalog are prize requirements, not
  customer requirements. Keep them, but don't let them set the roadmap.

---

## 9. Decisions needed from you

1. Which beachhead to interview first: fintech vendors → banks, healthcare, or crypto-native? (I'd lead with fintech.)
2. Do we change the plan's anchor from "marketplace" to "sealed trial"? That means a change-log line in
   `docs/TASKS.md` and edits to `docs/PLAN.md` §1 and the non-goals. I haven't touched those.
3. For the hackathon slice: evaluate-only on whatever hardware you can really provision today, yes/no?

---

## Sources
- [MELLODDY at tech.eu](https://tech.eu/2022/07/13/eu-backed-healthcare-project-rolls-out-platform-for-federated-learning-in-drug-discovery/) · [PMC article](https://pmc.ncbi.nlm.nih.gov/articles/PMC11005050/)
- [Data clean rooms compared (Decentriq)](https://www.decentriq.com/article/data-clean-rooms-compared) · [clean room adoption summary](https://www.dialectica.io/community-hub/the-rise-of-first-party-data-and-clean-rooms-market-trends-and-enterprise-adoption-in-2025)
- [Opaque Systems directory entry](https://komo.ai/directory/opaque-systems)
- [Bank AI vendor evaluation (ProgressSoft)](https://www.progressoft.com/blogs/beyond-the-pitch-a-framework-for-evaluating-ai-solutions-in-banking) · [Vendor onboarding and back-testing](https://mikenguyen13.github.io/credit_score/chapters/34b-vendor-onboarding-backtest.html) · [SR 11-7 and vendor products](https://www.proofpoint.com/jp/legal/trust/banking-organizations-and-validation-of-vendor-and-other-third-party-products-under-sr-letter-11-7)
- [Marketplace growth strategies (single-player mode)](https://www.aakashg.com/marketplace-growth-strategies/)
- [Sacra on Hugging Face](https://sacra.com/chat/h/f1b08238-e0bc-4f76-9862-82f01168e321/)
- Plus the sources in `validation.md` §11.
