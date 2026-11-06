# Idea validation: SealedAI (working name)

Date: 2026-11-06 (ETHGlobal Mumbai runs 6–8 Nov 2026, so the build window is open now).
Scope: criticise `docs/PLAN.md` rev 3 against real customer demand. Every external claim has a link. **Evidence
strength** is marked A (primary or vendor doc, peer-reviewed or press-reported fact), B (credible secondary), or
C (weak, aggregator or marketing). Anything I could not verify is listed in §8 and is not used as proof.

---

## 1. Verdict

**The technology works on paper. The demand is the weak part.** The plan builds a two-sided marketplace, a
TEE runtime, a GPU attestation verifier, an LLM planner and an escrow, for a transaction that today's buyers mostly
get more simply from a cloud provider or a model vendor. Four of the six failures below are about *who the customer
is*, not about code.

| # | Gap | Severity | Evidence |
|---|---|---|---|
| F1 | No named buyer who needs *someone else's* model *and* cannot use a cloud fine-tune | **Critical** | §3 |
| F2 | The seller side is real (Cohere, Mistral) but sells private deployments, not marketplace listings | **Critical** | §3 |
| F3 | The MVP model (DistilBERT/Qwen-0.5B classification) is not a product anyone pays a seller for | **High** | §4 |
| F4 | "Attested/confidential" claim is breakable with <$1,000 of hardware; our SECURITY.md puts that out of scope | **High** | §5 |
| F5 | Data/model marketplaces have a poor track record; ours repeats the cold-start problem | **High** | §6 |
| F6 | Scope vs. a 36-hour window: the dependency chain cannot be finished and verified | **High** | §7 |

---

## 2. What customers demonstrably want (the demand we can lean on)

1. **Privacy is the #1 stated barrier to enterprise AI.** Data privacy and security: 73% of C-level executives
   (BearingPoint, Apr 2025), 72% of tech professionals put it in their top three and 40% rank it first (Deloitte);
   other 2025 surveys give 36–65% depending on the sample. [Roundup of these surveys](https://www.cfodive.com/news/deloitte-generative-AI-survey/727891/),
   [GIC survey](https://www.singaporelawwatch.sg/Headlines/generative-ai-a-top-priority-for-firms-but-privacy-concerns-remain-gic-survey).
   Strength **B** (survey figures, different populations, not about our product).
2. **Model vendors want to ship to customers without losing the weights.** Fortanix describes providers choosing
   between "forgo lucrative enterprise sales or risk shipping models to customer data centers" and sells confidential
   inference as the fix. [Fortanix](https://www.fortanix.com/blog/confidential-ai-is-key-to-protecting-model-weights).
   Strength **C** (a vendor with a product to sell).
3. **Private deployment is where model vendors earn money.** About 85% of Cohere's revenue is private deployments on
   multi-year contracts, ~$240M ARR by April 2026; Mistral also sells on-prem and annual licences.
   [Sacra on Cohere](https://sacra.com/chat/h/58f54878-9149-4250-8f39-ca469c647990/). Strength **B/C** (Sacra is a
   secondary research summary; re-check against Cohere's own statements before quoting a number on stage).
4. **Small, fine-tuned models are genuinely useful.** Fine-tuned small models beat zero-shot LLMs on text
   classification by roughly 10–25 accuracy points in recent benchmarks.
   [arXiv 2406.08660](https://arxiv.org/html/2406.08660v2), [arXiv 2511.07989](https://arxiv.org/abs/2511.07989v1).
   Strength **A** for the claim, but see F3 for why it doesn't help us.
5. **GPU TEEs are fast enough.** H100 confidential computing overhead averages <9%, near zero for large models, the
   cost is mostly PCIe transfer. [arXiv 2409.03992](https://arxiv.org/html/2409.03992v4). Strength **A**.
   So performance is *not* the objection. Availability and trust are (see F4, F6).

Conclusion: the *problem statement* (private data + protected IP) is real. Everything below is about whether this
particular product is how it gets solved.

---

## 3. F1 and F2: no identifiable buyer, and incumbents already serve the real one

### The product's core claim
> "A buyer privately evaluates and customizes a seller's proprietary AI model on the buyer's private data."

### Where it fails

**3.1 Enterprises mostly buy API access, not customizable models.** Closed-source models power ~87% of enterprise
workloads; open-source share fell from 19% to 11–13%; 76% of use cases are bought rather than built (53% in 2024).
Enterprise gen-AI spend was $37B in 2025. [Menlo Ventures 2025](https://markets.financialcontent.com/dowtheoryletters/article/gnwcq-2025-12-9-menlo-ventures-2025-state-of-generative-ai-report-enterprise-investment-hit-37b-in-2025-tripling-in-one-year),
[Menlo mid-year](https://menlovc.com/wp-content/uploads/2025/11/menlo_ventures_mid-year_llm_report-2025.pdf).
Strength **A/B**. Implication: the buyer we imagine, a team that wants to take a third-party model and tune it on
private rows, is a minority behavior.

**3.2 Fine-tuning itself is a minority behavior.** One roundup puts RAG in production at 51% of enterprise
deployments against 9% mainly fine-tuning. [Artiba/other roundups](https://gentic.news/article/enterprises-favor-rag-over-fine-tuning-for-production).
Strength **C** (blog-level aggregator; the direction is consistent with the Menlo build-vs-buy shift, the exact
numbers are not safe to quote). Implication: our "tune the model to your goal" step addresses a smaller slice than
RAG, where buyer data is only *read*, not trained on.

**3.3 The cloud already offers "fine-tune on my private data, no leakage."** Azure OpenAI fine-tuned models are
exclusive to the customer, training data isn't used to train base models, and it stays in the customer's tenant,
with private endpoints. [Microsoft data privacy](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy).
Bedrock fine-tuning runs in a no-internet VPC with private S3 endpoints.
[AWS Bedrock customization](https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-submit.md).
Strength **A** (vendor docs). Buyers who fear data leakage but already trust a hyperscaler contract have a one-click
answer. Our product asks them to also trust a new runtime, a new escrow, a crypto wallet and an unaudited image.

**3.4 The seller's IP problem already has a mainstream answer.** AWS Marketplace model packages run without network
access, the buyer never receives the model code/weights, sellers keep ownership.
[AWS Marketplace ML IP](https://docs.aws.amazon.com/marketplace/latest/userguide/ml-security-and-intellectual-property.html).
Strength **A**. Note the gap: AWS protects the seller **from the buyer** but the buyer must trust AWS with data.
That is the exact niche for a TEE (neither party trusts the host), and it's our one genuine wedge. We aren't
currently pitching it that precisely.

**3.5 Sellers with real money in this space sell direct.** Cohere and Mistral close multi-year private-deployment
contracts through enterprise sales (see §2.3). A big-ticket seller does not list a flagship model on an
unknown hackathon marketplace; the plausible sellers are small: fine-tune shops, domain-model builders,
researchers. We have no evidence those sellers exist in number or that buyers pay them.

### What a buyer actually needs that we don't give them (from the evidence above)
- Legal and compliance sign-off (a hyperscaler contract/BAA, not a testnet escrow).
- Production SLAs and a model that beats a prompted frontier model on their task.
- Hosted inference at real scale (we offer "N calls / D hours" from one worker).

### Fix
Name one buyer and one seller before writing more code (§9, step 1). Candidates with a *specific* both-sides-distrust
structure, where a hyperscaler cannot be the neutral party:
- **Cross-organisation:** a hospital or lab (data cannot leave) + a medical-model builder (weights cannot leave).
- **Regulated-sector benchmarking:** a bank evaluates a vendor's fraud/credit model on its own rows and only gets
  aggregate scores, with no tuning step. This needs only **evaluate**, not train, and is a much smaller build.

---

## 4. F3: the MVP model is not a product

The plan's MVP: `distilbert-base-uncased` (66M) or `Qwen2.5-0.5B`, text classification, ≤2 LoRA/head-only runs
([PLAN §2 D, §3.3](docs/PLAN.md)).

- Both are **public, freely downloadable** models. No seller has IP in them and no buyer needs a marketplace to
  get them. The demo therefore doesn't show the thing we claim to protect.
- A buyer with ≥5k labeled rows can fine-tune DistilBERT on one rented GPU in minutes without us; modern tooling
  makes LoRA on consumer GPUs routine. [Fine-tuning vs RAG 2026](https://articles.firstaimovers.com/articles/fine-tuning-llms-vs-rag-2026/)
  (strength **C**). The only reason to come to us is the seller's *proprietary* weights, which the demo doesn't have.
- The recipe space is 5 enumerated groups, ≤2 runs. A buyer will ask what an LLM planner adds over a 20-line
  grid search. The agent exists to qualify for the 0G Private Computer track (PLAN §7), which is a sponsor
  reason, not a customer reason. Judges and customers will both notice.

### Fix
- Demo with a **seller-owned model that is visibly not public** (e.g. a model the team fine-tuned on a niche corpus
  and licenses), and show that the buyer could not obtain its weights via the API.
- Present the agent as optional "recommendation" and show one case where it beats default hyperparameters on the
  holdout. If it can't, say so and cut it. That's an honest slide and a smaller build.

---

## 5. F4: the confidentiality claim has a known break, and our threat model excludes it

SECURITY.md §1 lists "TEE hardware or side-channel breaks, and a compromise of NVIDIA/Intel attestation roots" as
**out of scope**, while the product promise is "neither the platform, the host, nor the other party can read either
asset", and the allowed word is "attested".

Evidence (strength **A**, press coverage of peer-reviewed security research):
- **TEE.fail** (Georgia Tech / Purdue, Oct 2025): a sub-$1,000 DDR5 interposer extracts keys from **Intel TDX** and
  AMD SEV-SNP, including secret attestation keys from fully updated machines, enough to **forge TDX attestations**
  and impersonate a genuine TEE; reported to also defeat NVIDIA GPU confidential computing setups. Two related
  attacks, Battering RAM and WireTap, landed weeks before.
  [The Hacker News](https://thehackernews.com/2025/10/new-teefail-side-channel-attack.html),
  [BleepingComputer](https://www.bleepingcomputer.com/news/security/teefail-attack-breaks-confidential-computing-on-intel-amd-nvidia-cpus/amp/).
- Our threat model includes the **cloud/host operator** as an adversary. That's precisely the attacker who can put
  a memory interposer on a server they own. Against that adversary, TDX alone does not deliver what the pitch
  says. Hyperscaler clouds mitigate by physical controls, which a "hosted by whoever" decentralized network can't
  promise.
- Practicality: IDC-reported figures say validating attestation chains is the top adoption hurdle for 84% of IT
  leaders. [Census Labs summary](https://census-labs.com/resources/operationalizing-confidential-computing-verifiable-attestation-in-practice)
  (strength **C**, secondary; I did not verify the IDC original). If real attestation verification is hard for
  enterprises, a consumer-grade client verifier is a bigger ask.

### Fix
1. **Change what we claim.** Replace "neither party can read" with "protected against software and remote
   operators; physical attacks by the host operator are out of scope **unless** the worker runs in a facility
   the buyer or seller trusts." State this in the Offer and in the UI (SECURITY allowed-claims).
2. Move the physical-attack row from "out of scope" to a **named residual risk** with a mitigation: run the worker
   only on providers with physical-access controls (hyperscaler confidential VMs, e.g. Azure NCC H100 v5, GA since
   Sep 2024 [NVIDIA](https://blogs.nvidia.com/blog/azure-confidential-vm-h100-general-availability)), and make the
   provider identity part of the signed Offer so each party can refuse hosts they don't trust.
3. Say plainly in the pitch which of the three guarantees is cryptographic (escrow, signatures, Merkle roots) and
   which rests on hardware vendors.

---

## 6. F5: marketplaces for data and models in this style have a weak record

- **Ocean Protocol** built compute-to-data (the same idea: compute goes to the data). Commentary says
  adoption stayed modest, data owners with valuable data didn't onboard at scale, most listings were low-quality
  (strength **C**: [analysis](https://medium.com/@scottmilat/go-to-market-analysis-for-data-markets-data-brokers-on-ocean-protocol-ed644b66267c),
  [aggregator](https://coinclear.pages.dev/ai-depin/ocean-protocol); these are opinion pieces, not usage statistics).
  The better-evidenced fact: Ocean's foundation left the ASI Alliance on 9 Oct 2025 amid a token dispute
  ([The Block](https://www.theblock.co/news/ecosystems/2025-10-09-ocean-protocol-withdraws-from-artificial-superintelligence-alliance-373977),
  strength **A**), which says the ecosystem is unstable, not that C2D lacks demand. Treat "Ocean failed for lack of
  demand" as **plausible, not proven**.
- **Hugging Face**, the actual model marketplace, monetizes governance, private repos and dedicated endpoints for
  enterprises, not seller revenue shares; a paid model marketplace is described as an open, harder opportunity.
  [Sacra](https://sacra.com/chat/h/f1b08238-e0bc-4f76-9862-82f01168e321/) (strength **C**).
- **Cold start is unsolved in the plan.** Plan non-goals drop pricing mechanics, discovery and reputation
  (D8 defers ERC-8004 feedback; Arkiv scores are "buyer-reported"). A listing page with zero listings isn't a
  marketplace.

### Fix
Don't build a marketplace; build **a verified transaction between two named parties** and show the second
and third customer as an *intention* (LOIs, interviews), not as a "browse page". Keep Arkiv only as a public
receipt/log of completed jobs, which is a use of Arkiv that doesn't need a catalog.

---

## 7. F6: scope against the clock and the plan's own open questions

From PLAN §11, still **open** (all marked VERIFY): 0G hosted-worker route (H1), TappRegistry getter, GCP H100
confidential quota ("reported experiment flag error"), NVIDIA GPU attestation verifier choice and binding, CPU-TEE
training time, direct TeeML TLS behavior, ETHGlobal prize limits.

- TAPP does **not** verify the GPU report signature itself (plan §3.1, `cvm/GPU.md`), so the GPU trust path is code
  we must write and test ourselves.
- The plan's own recommendation depends on a quota request "early". It is 6 Nov and the hackathon is 6–8 Nov
  ([event listing](https://events.coinpedia.org/ethglobal-mumbai-8003/), strength **B**).
  Cloud GPU quota approvals can take days. If not already approved, the GPU path is not available during the event.
- Deliverables in the plan: protocol package, planner, client with CPU+GPU verifier, TS control plane, Python ML
  plane, TAPP image, ERC-8183 escrow with adversarial tests, 0G Storage and Router adapters, Arkiv adapter, CLI
  and web UI. The rules in CLAUDE.md (no mock mode, nothing "verified" without evidence) mean a partially working
  demo cannot be shown as the real thing.
- Azure NCC H100 v5 is a confidential GPU VM available in a few regions at ~$6.98/hr (strength **C**,
  [buyers guide](https://www.beri.net/article/confidential-gpu-inference-azure-ncc-h100-vs-google-a3-vs-aws-nitro-enclaves-buyers-guide),
  not verified against Azure's own price page), but it is AMD SEV-SNP, not Intel TDX, so it does not match
  the TAPP/TDX path in the plan.

### Fix: cut to the smallest thing that is still true
Vertical slice order (each item is demo-able alone):
1. **Evaluate-only** (no training): seller model + buyer rows → aggregate score, in an enclave, escrow pays on a
   signed receipt. Drops the planner, LoRA trainer, GPU training time, and the C1 hosted inference server.
2. Real attestation verification on **one** hardware route (whatever you can actually provision today; CPU TDX if
   no GPU quota).
3. Only then add head-only training and the planner.
If there is no real TEE by the demo, **say so**; per CLAUDE.md there is no mock mode, and a banner reading
"no hardware evidence, nothing released" is a better demo than a fake green tick.

---

## 8. What I could not verify (don't present these as facts)

- Exact market size for "private model customization on third-party models". No source found.
- Number of model sellers who would list on a marketplace. No source found.
- Ocean C2D usage numbers: only opinion pieces, no transaction statistics.
- IDC "84% attestation" figure: found only via secondary summary.
- 0G Private Computer details beyond the 0G blog ([0G blog](https://0g.ai/blog/0g-private-computer),
  [verifiable execution docs](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/verifiable-execution)).
  Not independently tested here. Note the Router is a gateway to **0G-hosted** models; the plan already keeps buyer
  rows and weights off it.
- The prize amounts and rules for the ETHGlobal Mumbai event (the search found dates but no prize page).
- Whether TEE.fail applies to the specific hardware/config we would rent.

---

## 9. How to validate before building more (48-hour plan)

| Step | Action | Pass condition | Kill / pivot condition |
|---|---|---|---|
| 1 | Write the one-sentence customer: "[role] at [org type] who has [data] that can't leave and wants [model] they can't download" | You can name 5 real organisations | Can't → pitch as infrastructure/primitive, not marketplace |
| 2 | 5 short interviews (ETHGlobal attendees, sponsors' mentors, any health/fintech devs there): "How do you fine-tune on private data today? What stops you using a cloud tuning service?" | ≥2 say a hyperscaler contract is not acceptable for a named reason | All 5 say "we'd use Bedrock/Azure" → drop the training step, keep the evaluate-only escrow |
| 3 | Ask 2 would-be sellers: "Would you put weights into a 3rd-party enclave? Under what proof?" | ≥1 gives conditions we can meet | They require legal indemnity/audits → position as a pilot tool |
| 4 | Build vertical slice 1 (evaluate-only) and run it end to end on real evidence | Seller and buyer both verify and a receipt settles | Evidence can't be produced in the window → ship the protocol + failure-mode demo only |
| 5 | Rewrite the claims against §5 (named residual risks) and the pitch against §3 | Docs updated; change-log line in TASKS | — |

## 10. Rewrite of the pitch the evidence can support

> "When neither side trusts the host, the cloud can't be the referee. A model owner and a data owner run one
> evaluation inside hardware that both verify themselves, the buyer gets a score and the seller gets paid, and
> neither sees the other's asset. Today that means trusting a hyperscaler or shipping weights. We replace that trust
> with evidence each party checks on its own."

Drop: "marketplace", "AI agent tunes the model" (unless §4 shows it adds value), "neither the host nor anyone can
read" (see §5).

---

## 11. Source list

- [Menlo Ventures 2025 State of Gen AI](https://markets.financialcontent.com/dowtheoryletters/article/gnwcq-2025-12-9-menlo-ventures-2025-state-of-generative-ai-report-enterprise-investment-hit-37b-in-2025-tripling-in-one-year) · [mid-year report](https://menlovc.com/wp-content/uploads/2025/11/menlo_ventures_mid-year_llm_report-2025.pdf)
- [Deloitte via CFO Dive](https://www.cfodive.com/news/deloitte-generative-AI-survey/727891/) · [GIC survey](https://www.singaporelawwatch.sg/Headlines/generative-ai-a-top-priority-for-firms-but-privacy-concerns-remain-gic-survey)
- [Azure OpenAI data privacy](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy) · [AWS Bedrock customization](https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-submit.md) · [AWS Marketplace ML IP](https://docs.aws.amazon.com/marketplace/latest/userguide/ml-security-and-intellectual-property.html)
- [Fortanix: confidential AI and model weights](https://www.fortanix.com/blog/confidential-ai-is-key-to-protecting-model-weights)
- [Sacra: Cohere private deployments](https://sacra.com/chat/h/58f54878-9149-4250-8f39-ca469c647990/) · [Cohere docs](https://docs.cohere.com/docs/private-deployment-overview)
- [The Hacker News: TEE.fail](https://thehackernews.com/2025/10/new-teefail-side-channel-attack.html) · [BleepingComputer](https://www.bleepingcomputer.com/news/security/teefail-attack-breaks-confidential-computing-on-intel-amd-nvidia-cpus/amp/)
- [H100 CC benchmark, arXiv 2409.03992](https://arxiv.org/html/2409.03992v4) · [NVIDIA: Azure H100 confidential VMs GA](https://blogs.nvidia.com/blog/azure-confidential-vm-h100-general-availability)
- [Fine-tuned small LLMs vs zero-shot, arXiv 2406.08660](https://arxiv.org/html/2406.08660v2) · [arXiv 2511.07989](https://arxiv.org/abs/2511.07989v1)
- [The Block: Ocean exits ASI Alliance](https://www.theblock.co/news/ecosystems/2025-10-09-ocean-protocol-withdraws-from-artificial-superintelligence-alliance-373977) · [Ocean GTM analysis](https://medium.com/@scottmilat/go-to-market-analysis-for-data-markets-data-brokers-on-ocean-protocol-ed644b66267c)
- [Sacra on Hugging Face](https://sacra.com/chat/h/f1b08238-e0bc-4f76-9862-82f01168e321/) · [Census Labs: attestation in practice](https://census-labs.com/resources/operationalizing-confidential-computing-verifiable-attestation-in-practice)
- [0G Private Computer](https://0g.ai/blog/0g-private-computer) · [0G verifiable execution](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/verifiable-execution)
- [ETHGlobal Mumbai listing](https://events.coinpedia.org/ethglobal-mumbai-8003/)
