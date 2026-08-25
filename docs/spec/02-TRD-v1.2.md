# Document 2 — Technical Requirements / Architecture Document (v1.2)

**Supersedes:** `02-TRD-v1.1.md`.
**Scope:** Product V1 — Portfolio + News Intelligence.
**Design principle:** *the simplest architecture that one person, working primarily with AI assistance and unwilling to be a sysadmin, can operate reliably for five years — and extend into V2–V4 without a rewrite.*

Selection criteria in priority order: **(1) reliability, (2) low operational burden, (3) data quality, (4) maintainability with AI assistance, (5) cost, (6) portability.**

---

## 1. Sizing

| Dimension | V1 reality |
|---|---|
| Users | 1 |
| Accounts | 2–6 |
| Assets in universe | 30–150 |
| Transactions | <5,000 lifetime |
| Price rows | ~750k |
| Documents | 150–400/day → ~100k/year |
| AI calls | 50–300/day |
| Peak concurrency | 1 |

**Small-data application.** Kafka, microservices, Kubernetes, data lakes, streaming layers and dedicated vector databases are all wrong here. If a design reaches for them, treat it as a defect.

**What v1.2 removes relative to v1.1:** the entire fundamentals subsystem, the historical FX subsystem, and the thesis/decision subsystem. Roughly 40% of the v1.1 table count and a larger share of its calculation surface.

---

## 2. Stack *(retained from v1.1 — no reason to reopen)*

### 2.1 Shape: modular monolith, two services

One codebase deployed as **web** (Next.js UI + API) and **worker** (scheduler + job executors), sharing one Postgres database.

Splitting web from worker is not microservices; it is the minimum separation preventing a long-running ingestion job from degrading interactive response, and it is how managed platforms expect a job-bearing app to be structured.

**V1 modules:** `ledger`, `marketdata`, `fxdisplay`, `documents`, `events`, `moves`, `ai`, `provenance`, `ops`.
**V2 will add:** `fundamentals`, `thesis`, `decisions`. **V3:** `valuation`. Module boundaries are drawn now so these attach rather than interleave.

### 2.2 Database: PostgreSQL

- **Transactional integrity** across linked transaction rows — a half-written transfer that debits one account without crediting the other is unacceptable.
- **`NUMERIC(28,10)`** for all money and quantity. Floating-point money is a silent-error generator.
- **JSONB** only where shape is genuinely variable (AI output payloads, reconciliation snapshots, job coverage).
- Full-text search built in — sufficient for document search at this scale.
- Mature, portable; a `pg_dump` is a `pg_dump` on any platform, which is the entire portability story.

**pgvector is not installed in V1.** Semantic clustering is V4, and even then may be unnecessary — see TDD v1.2 §11.

### 2.3 Language: TypeScript, unified

Next.js App Router + a TypeScript worker in the same repository, sharing types and the data-access layer.

With AI-assisted implementation the dominant cost is specification clarity and feedback-loop tightness, not typing speed. One language means one type system spanning the numeric context bundle, the API contract and the renderer — exactly the seam the unsourced-numeric guardrail depends on. A mismatch there is a compile error rather than a wrong number on screen.

Use `decimal.js` or `big.js` for money. **Never native floats.**

**Note on the v1.1 trade-off:** the argument for Python was better numerical and XBRL tooling in the valuation module. **That module is now V3**, which weakens the case for Python further and settles this decision for the foreseeable future.

### 2.4 Jobs: database-backed queue

Jobs table in Postgres with `SELECT … FOR UPDATE SKIP LOCKED`, plus cron-style triggers, running in the worker. `pg-boss` is the natural library.

**No Redis.** Job history lives beside the data it produced, so "why is this number stale?" is one SQL query. At <100 jobs/day, throughput is irrelevant and observability is everything.

### 2.5 Hosting: managed platform + managed Postgres

**Recommendation retained: Render, Singapore region** — one web service, one background worker, one managed Postgres, native cron.

<cite index="50-1">Render provides dedicated service types for background workers and cron jobs configurable from the dashboard, and managed PostgreSQL as a native service, with plan-based rather than credit-based billing so services do not stop on a credit threshold.</cite> <cite index="43-1">Regions include US East, US West, Europe and Singapore, selected per service, and portability is good — a Render Postgres dump is a Postgres dump, so moving elsewhere is straightforward.</cite> <cite index="62-1">Managed Postgres includes automatic backups, point-in-time recovery and monitoring.</cite> Indicative pricing: <cite index="59-1">a Starter web service is $7/month, Standard $25/month; a typical web + managed Postgres + background worker setup runs roughly $21–52/month.</cite>

**Alternative: Railway.** <cite index="46-1">Seven regions including Asia Southeast with per-service selection.</cite> The deciding difference remains job handling: <cite index="54-1">Railway has no dedicated background worker service type, so long-running consumers and scheduled jobs end up inside web service processes or cron-based workarounds</cite>, and <cite index="57-1">it requires external scheduling for cron jobs</cite>. <cite index="57-1">Railway's usage-based pricing is cheaper for low-traffic workloads that scale to zero, while Render's fixed pricing is more predictable for steady always-on apps</cite> — and this is a steady always-on app.

**Not recommended:** Fly.io (<cite index="55-1">database options are powerful but more configurable and require more attention</cite>; global edge distribution is worth nothing to a single user); Vercel plus separate Postgres (splits the deployment across platforms for no benefit, since workers must live elsewhere).

**Verify in M0:** managed Postgres availability **in Singapore specifically**, backup retention and PITR window on the intended tier, current pricing, and one live rollback.

**Portability obligations.** No dependency on platform-specific queues, key-value stores, edge runtimes or proprietary secret formats. Everything is Postgres, environment variables and a container.

**Backups, belt and braces.** Platform-managed backups **plus** an independent encrypted nightly `pg_dump` to object storage at a *different* provider. Platform backups protect against hardware failure; your own dump protects against account loss, billing failure and provider exit. **Restore executed and verified before launch and quarterly thereafter.** An untested backup is not a backup.

---

## 3. Data providers

### 3.1 What V1 needs, and what it explicitly does not

| Need | V1 | Notes |
|---|---|---|
| US EOD prices | ✅ | Held and watched assets |
| Historical price series | ✅ | Charts, material-move baselines |
| Crypto prices in USD | ✅ | |
| ETF prices | ✅ | Treated as equities |
| **Splits and dividends** | ✅ | **Added in v1.2 — see §3.2** |
| Asset profile metadata (name, sector, exchange) | ✅ conditional | Sector only if reliable — PRD A5 |
| Latest USD/SGD spot | ✅ | One rate, display only |
| SEC filings as documents | ✅ | Free |
| Issuer feeds | ✅ where practical | Free |
| Commercial news | ✅ | One provider |
| **SEC XBRL companyfacts** | ❌ **V2** | Financial database, not documents |
| **Normalised fundamentals** | ❌ **V2** | |
| **Historical FX series** | ❌ **removed** | |
| ETF holdings files | ❌ **V2** | Look-through deferred |

### 3.2 Market data vendor — selected in M0

Candidates, with the standing caveat that pricing and plans change and must be verified before subscribing:

| Vendor | Position | Indicative entry |
|---|---|---|
| **EODHD** | Broad coverage; EOD + splits/dividends + FX + crypto + news on one bill | <cite index="11-1">All-World EOD ~$19.99/mo; ~$29.99 with intraday; ~$59.99 fundamentals; ~$99.99 all-in-one</cite> |
| Tiingo | Clean EOD, curated ticker-tagged news | Low-cost tiers |
| FMP | Broad endpoint set | <cite index="14-1">~$22/mo lowest paid entry</cite> |
| Finnhub | Generous free tier, practical mix of quotes and news | Free tier viable for prototyping |

**Working recommendation: EODHD**, on the grounds that one vendor plausibly covers EOD prices, corporate actions, spot FX, crypto and news — eliminating four integrations.

**Important change from v1.1:** V1 does **not** need the fundamentals tier. That materially lowers the cost — you can start on a prices-and-news plan and add fundamentals only when V2 begins. **Do not subscribe to a fundamentals plan for V1.**

**M0 must validate:** US EOD accuracy · historical depth · **splits and dividends: coverage, timeliness relative to ex-date, historical depth, and whether adjusted and unadjusted series are both available** · crypto in USD · ETF support · symbol mapping · API reliability · rate limits · **private-use licensing** · cost.

**The corporate-action check is not optional.** With no fundamentals layer to cross-check against, the vendor's split feed is V1's only defence against silent ledger corruption. If it is unreliable, V1 needs a manual corporate-action path plus the detection rule in PRD MD5.

<cite index="16-1">Note also that entry tiers look affordable but rate-limit upgrades often cost more than the data itself, and each API uses different symbol formats, date conventions and normalisation rules — so switching providers typically means rewriting the data-fetching layer.</cite> That is exactly why the adapter interface (§7) exists.

### 3.3 Prices

**EOD close only. No real-time data, no websockets.** This is both a cost decision and a behavioural one: real-time price data is the single largest driver of the reactive habits V1's design is trying not to create, and a long-horizon holder makes the same decisions with a delayed quote.

### 3.4 USD/SGD display rate — drastically simplified

**Requirement: one latest rate, with a source and a timestamp.** No historical series, no fixings table, no LOCF logic, no staleness-refusal policy, no execution rates, no provider redundancy.

**Selection:** whichever reliable API source is easiest to integrate. **Prefer the market-data vendor's FX endpoint** — zero additional integrations. Otherwise any stable, licensable rate API.

**M0 validates only:** latest-rate availability · source reliability · timestamp presence · licensing. **Historical FX depth is explicitly not a V1 blocker** — a change from v1.1, where it was.

Google Finance may remain a manual comparison reference. It is not the application's backend source.

**Architectural constraint, and it is the important one:** the SGD conversion is a **render-time decoration**. It reads a cached spot rate, is never persisted, never enters a calculation, and **its failure mode is a string, not an error.** No job in the system may be capable of breaking the portfolio because an FX call failed. This is asserted by AC-SGD1.

### 3.5 SEC filings — documents, not XBRL

**V1 uses:** the submissions API for filing discovery by CIK, accession numbers as natural event keys, 8-K item codes for free structured event typing, and document retrieval for text.

**V1 does not use:** companyfacts, us-gaap tags, frames, or any XBRL endpoint.

<cite index="9-1">The official SEC EDGAR API is free and rate-limited to 10 requests per second.</cite> That limit is generous for a 150-name universe polled every 20 minutes.

**This separation is architectural, not just documentary.** The filings adapter and the (future) XBRL adapter are separate provider adapters sharing only the CIK. V2 adds one without touching the other.

### 3.6 News

Start with the market-data vendor's bundled news feed to avoid a fourth integration. Add a dedicated provider only on demonstrated coverage gaps: <cite index="22-1">Marketaux includes news in a ~$30/mo plan plus a free starter tier</cite>; <cite index="23-1">Benzinga via Massive covers analyst actions and earnings, while Marketaux offers broad entity coverage across 80+ markets</cite>.

**Do not subscribe to sentiment scoring.** V1 forbids using it, and paying for an unused signal is how scope creeps back.

**Entity linking is your job, not the vendor's.** Vendor ticker tagging is the weak point of every news API. The rule layer over a bounded 150-name universe is tractable precisely because the universe is bounded.

### 3.7 AI

Hosted LLM behind a **swappable adapter**.

- **Cheap/fast model:** relevance triage, entity disambiguation — 90%+ of call volume
- **Capable model:** filing and news summarisation with claim extraction
- **Embeddings:** not used in V1

For Claude, verify current models and pricing at https://docs.claude.com/en/api/overview rather than trusting a figure in a design document. **Batch APIs materially reduce cost** for nightly and hourly triage, none of which is latency-sensitive.

**Cost control:** hard monthly cap · per-task budgets · caching keyed on `input_hash` · nightly cost report · ordered degradation ladder in which **triage degrades last**, because losing triage means losing the product's core function while losing summaries only means reading the source.

Estimate USD 20–50/month; confirm against real usage in month one.

---

## 4. Authentication and security

Single user, treated as a financial record — because it is one.

- **Auth:** WebAuthn passkey preferred, or password + TOTP. **No public signup route**; account creation is a seed operation.
- TLS, HSTS, strict CSP, **no third-party analytics, fonts or scripts on any page rendering portfolio data**.
- Secrets in the platform secret manager, never in the repository; vendor keys rotated on a calendar reminder.
- Managed Postgres: not publicly reachable, encrypted at rest, strong credentials.
- **Backups:** platform-managed plus independent encrypted nightly dump elsewhere; restore verified pre-launch and quarterly.
- **Audit log** on all mutations to transactions, accounts and watchlist items.
- **AI data handling:** an enforced field allow-list governs prompt contents. **Position sizes, quantities, cost basis and account values are excluded by default** — enforced by the bundle builder, asserted in tests, not left to prompt discipline. The model needs document text and asset identity; it does not need to know how much you own.
- Login rate limiting; session expiry; no indefinite "remember me".

---

## 5. Logging and observability

Three mechanisms, all in Postgres:

1. **Structured JSON application logs**, 30-day retention, correlation ID per request and job.
2. **`job_runs`** — every scheduled run records start, end, status, records in/out, coverage summary and error. **This table is the data-health dashboard.**
3. **`data_quality_flags`** — rule violations raised and resolved.

Plus a **daily digest email**: job outcomes, flags raised, AI spend, ingestion coverage. Push, don't poll.

**Not needed:** Prometheus, Grafana, distributed tracing, APM.

---

## 6. Testing infrastructure

- **Unit and property tests** on all ledger math (TDD v1.2 §13).
- **Golden-file ledger fixture** including multi-account, split, transfer, dividend with withholding — written before ledger code.
- **Recorded vendor fixtures (VCR-style)** so vendor outages never break CI and response shapes are permanently recorded.
- **SGD failure-injection test** — disable the FX source and assert the dashboard renders complete USD figures with no error.
- **Labelled evaluation sets** for entity linking and relevance triage. Version-controlled test assets.
- **Adversarial numeric set** for the guardrail.
- **Claim-excerpt injection tests** — fabricated excerpts rejected 100% of the time.
- **Prompt snapshot tests** — prompts versioned like code, because `prompt_version` is recorded on every run.
- **Sort-parameter tests** — assert no endpoint accepts percentage-change ordering.

**Removed from v1.1's suite:** FX calendar fixtures (weekends, holidays, DST) — no historical FX exists to test. This was a meaningful chunk of v1.1's test surface.

---

## 7. Extensibility seams

Four seams must be clean, because retrofitting them is expensive:

1. **Provider adapters.** Every external source implements a common interface returning normalised, provenance-stamped records. Adding the V2 XBRL adapter or swapping the news vendor is a new adapter, not a rewrite.
2. **Asset-class polymorphism.** Core `assets` plus per-class attribute tables and capability flags. Adding SG/HK equities later is a new class and adapter, not schema surgery.
3. **AI task registry.** Every AI task is a named, versioned unit (task · prompt version · model · input schema · output schema · validator). Adding a task does not touch application code, and every output stays attributable.
4. **Stable surrogate IDs.** `assets.id`, `accounts.id`, `transactions.id`, `documents.id`, `events.id`, `sources.id` are permanent and never reused. **These are the attachment points for V2–V4.**

**And the corresponding discipline:** *do not create empty V2 tables.* No `theses`, no `fundamental_facts`, no `decisions` stubs in a V1 migration. An unused table is a maintenance burden, a migration hazard and an invitation to half-build a feature. **The attachment points are the IDs, not the tables.**

---

## 8. Estimated monthly cost

| Item | USD/mo |
|---|---|
| Managed platform (web + worker + Postgres) | 25–60 |
| Market data + corporate actions + spot FX + news (one vendor, **no fundamentals tier**) | 20–60 |
| SEC EDGAR, issuer feeds | 0 |
| LLM API | 20–50 |
| Independent backup storage | 1–5 |
| Domain | ~1 |
| **Total** | **~65–175** |

Lower than v1.1's ~75–225, principally because the fundamentals data tier moves to V2.

Under a USD 50 ceiling: use free vendor tiers plus SEC EDGAR, accept tighter rate limits and manual crypto entry. It works; it costs time instead of money.

---

## 9. Deliberate non-choices

Real-time prices and websockets · microservices · dedicated vector database · Kafka or streaming · Kubernetes · native mobile apps · multi-tenancy · composite scores or ratings · unscoped RAG · fine-tuning · real-time price alerting · self-managed VM infrastructure · **embedding infrastructure (V4 at earliest)** · **historical FX storage (removed)** · **XBRL integration (V2)** · **fundamentals data subscription (V2)** · **double-entry accounting**.
