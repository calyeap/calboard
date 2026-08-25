# Document 3 — Technical Design Document (v1.2)

**Supersedes:** `03-TDD-v1.1.md`.
**Scope:** Product V1 — Portfolio + News Intelligence.
**Conventions:** all money and quantity columns `NUMERIC(28,10)` — never floating point. All timestamps `TIMESTAMPTZ`, stored UTC. Milestone tags `[M1] [M2] [M3] [M4]`.

---

## 1. Schema map — and what is deliberately absent

### Tables in V1

| Group | Tables | Milestone |
|---|---|---|
| Reference | `assets`, `asset_identifiers`, `asset_aliases`, `asset_attributes_equity/etf/crypto`, `sources`, `accounts` | M1 |
| Market data | `prices_daily`, `corporate_actions`, `fx_spot_latest` | M1 / M2 |
| Ledger | `transactions`, `positions_current`, `account_cash`, `positions_daily`, `account_cash_daily`, `account_reconciliations` | M1 |
| Watchlist | `watchlist_items` | M2 |
| Moves | `material_moves` | M2 (detection) / M3 (catalyst) |
| Documents & events | `documents`, `events`, `event_documents`, `event_asset_links`, `document_filters` | M3 |
| AI | `ai_runs`, `ai_claims` | M4 |
| Operations | `job_runs`, `data_quality_flags`, `audit_log` | M1 |

**Total: 29 tables** (counting `asset_attributes_equity`, `_etf` and `_crypto` separately). v1.1 specified 45.

### Tables deliberately NOT created in any V1 migration

`theses` · `thesis_assumptions` · `assumption_observations` · `assumption_reviews` · `decisions` · `decision_transaction_links` · `decision_reviews` · `journal_notes` · `predictions` · `fundamental_facts` · `metric_source_policy` · `fact_cross_checks` · `derived_metrics` · `valuation_input_confirmations` · `valuation_runs` · `scenarios` · `etf_holdings` · `embedding_models` · `document_embeddings` · `fx_fixings` · `transaction_groups` · `transaction_legs`

**Not as stubs, not as empty tables, not "for later".** They attach to stable IDs when their product version arrives. An unused table is a migration hazard and an invitation to half-build a feature.

---

## 1.1 Migration order

Each milestone migrates on top of the previous one and **must apply cleanly with no later milestone present.** Within a milestone, objects are created in the order listed; every foreign key points at a table that already exists at that point.

### M1 — `001_portfolio_core`
```
CREATE TYPE asset_class
CREATE TYPE txn_type
1.  sources                 -- no FK; created first because assets references it
2.  assets                  -- FK → sources; self-FK → assets (valid within CREATE TABLE)
3.  asset_identifiers       -- FK → assets
4.  asset_aliases           -- FK → assets
5.  asset_attributes_equity / _etf / _crypto   -- FK → assets
6.  accounts                -- no FK
7.  prices_daily            -- FK → assets, sources
8.  corporate_actions       -- FK → assets, sources
9.  transactions            -- FK → accounts, assets, corporate_actions, self
10. positions_current       -- FK → accounts, assets
11. account_cash            -- FK → accounts
12. positions_daily         -- FK → accounts, assets, sources
13. account_cash_daily      -- FK → accounts
14. account_reconciliations -- FK → accounts
15. VIEW positions_aggregate               -- reads positions_current
16. job_runs, data_quality_flags, audit_log -- no FK
```
**M1 references nothing from M2–M4.** No watchlist, no material moves, no documents, no events, no AI, no thesis, no fundamentals, no valuation, no historical FX.

### M2 — `002_monitoring`
```
1. fx_spot_latest    -- FK → sources (M1)
2. watchlist_items   -- FK → assets (M1)
3. material_moves    -- FK → assets (M1), assets AS benchmark (M1)
                     -- NO linked_event_id: events does not exist yet
```
**M2 references only M1 objects.** `material_moves.catalyst_status` defaults to `'pending'`, which is the complete and correct M2 state: moves are detected and displayed with no catalyst information until M3 exists to supply it.

### M3 — `003_documents_events`
```
1. documents            -- FK → sources (M1)
2. events               -- FK → assets (M1)
3. event_documents      -- FK → events, documents
4. event_asset_links    -- FK → events, assets
5. document_filters     -- FK → documents
                        -- NO ai_run_id: ai_runs does not exist yet
6. ALTER TABLE material_moves
     ADD COLUMN linked_event_id BIGINT REFERENCES events(id);   -- nullable
```
**M3 references only M1 and M2 objects.** The `ALTER` in step 6 is the only backward touch, and it runs after `events` exists. Deterministic ingestion, entity linking, dedup and filtering are fully functional here **with no AI table present** — `document_filters.stage` covers `'universe'`, `'publisher_tier'`, `'syndication'` and `'pattern'` without needing `ai_run_id`.

### M4 — `004_ai`
```
1. ai_runs      -- no FK
2. ai_claims    -- FK → ai_runs, events (M3), documents (M3)
3. ALTER TABLE document_filters
     ADD COLUMN ai_run_id BIGINT REFERENCES ai_runs(id);        -- nullable
```
**Only here do AI-specific tables and foreign keys become available.** The `'ai_triage'` filter stage becomes usable at this point; every filter row written before M4 keeps `ai_run_id IS NULL`, which is correct rather than missing data.

**The general rule this encodes:** a later milestone may add a nullable column to an earlier milestone's table, but an earlier milestone may never reference a later one. Two forward references existed in the first draft of this document — `material_moves.linked_event_id` and `document_filters.ai_run_id` — and both are now resolved by deferred `ALTER`.

---

## 2. Reference `[M1]`

**Creation order matters here.** `assets.sector_source_id` references `sources`, so `sources` is created first. See §1.1 for the full per-milestone ordering.

```sql
CREATE TYPE asset_class AS ENUM ('equity','etf','crypto');
-- Note: no 'cash' member. Cash is derived, not an asset. See §4.5.

-- Created FIRST: assets references it.
CREATE TABLE sources (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,          -- 'SEC_EDGAR','VENDOR_X','FX_SPOT','ISSUER_RSS'
  kind TEXT NOT NULL,                 -- 'regulator','vendor','issuer','publisher','derived'
  reliability_tier SMALLINT NOT NULL, -- 1 = authoritative
  terms_url TEXT
);

CREATE TABLE assets (
  id                 BIGSERIAL PRIMARY KEY,
  asset_class        asset_class NOT NULL,
  primary_symbol     TEXT NOT NULL,
  exchange_mic       TEXT,
  name               TEXT NOT NULL,
  native_currency    CHAR(3) NOT NULL DEFAULT 'USD',  -- retained for V2+; unused in V1 math
  quote_currency     CHAR(3) NOT NULL DEFAULT 'USD',
  country            CHAR(2),
  sector             TEXT,
  sector_source_id   INT REFERENCES sources(id),
  sector_overridden  BOOLEAN NOT NULL DEFAULT FALSE,  -- user correction of vendor data
  industry           TEXT,
  sec_cik            TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,   -- archive, never delete
  move_threshold_pct NUMERIC(6,3),                    -- per-asset override
  benchmark_asset_id BIGINT REFERENCES assets(id),    -- for move context
  tags               TEXT[],                          -- optional soft relevance hints
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON assets (primary_symbol, COALESCE(exchange_mic,''));
CREATE INDEX ON assets (sec_cik) WHERE sec_cik IS NOT NULL;
```

**`assets.id` is the primary V2/V3 attachment point.** Theses, fundamentals and valuations will all hang off it. It must never be reused or derived from a symbol, because tickers change.

**`native_currency` and `quote_currency` are retained but unused** in V1 calculations. One column each now prevents a painful backfill if non-USD assets ever arrive. A V1 guard raises a data-quality flag if an asset with `quote_currency <> 'USD'` acquires a position, rather than silently mis-valuing it.

**`tags`** supports the optional soft relevance hints from Critical Review v1.2 §0.3. Free-form, never required, no validation, no UI nagging.

```sql
CREATE TABLE asset_identifiers (
  asset_id BIGINT REFERENCES assets(id) ON DELETE RESTRICT,
  scheme   TEXT NOT NULL,      -- 'ticker','isin','figi','cik','coingecko'
  value    TEXT NOT NULL,
  valid_from DATE, valid_to DATE,
  PRIMARY KEY (asset_id, scheme, value)
);

CREATE TABLE asset_aliases (
  asset_id     BIGINT REFERENCES assets(id) ON DELETE CASCADE,
  alias        TEXT NOT NULL,
  alias_type   TEXT NOT NULL,   -- 'legal','common','brand','product','ticker'
  is_ambiguous BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (asset_id, alias)
);

CREATE TABLE asset_attributes_equity (
  asset_id BIGINT PRIMARY KEY REFERENCES assets(id),
  fiscal_year_end_month SMALLINT
);
CREATE TABLE asset_attributes_etf (
  asset_id BIGINT PRIMARY KEY REFERENCES assets(id),
  expense_ratio NUMERIC(8,6), issuer TEXT, benchmark_name TEXT
);
CREATE TABLE asset_attributes_crypto (
  asset_id BIGINT PRIMARY KEY REFERENCES assets(id),
  network TEXT, quote_source TEXT
);

CREATE TABLE accounts (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  custodian  TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- No base_currency column. V1 is USD.
```

---

## 3. Market data `[M1]`

```sql
CREATE TABLE prices_daily (
  asset_id BIGINT NOT NULL REFERENCES assets(id),
  price_date DATE NOT NULL,
  open NUMERIC(28,10), high NUMERIC(28,10), low NUMERIC(28,10),
  close NUMERIC(28,10) NOT NULL,
  adj_close NUMERIC(28,10),
  volume NUMERIC(28,2),
  source_id INT NOT NULL REFERENCES sources(id),
  retrieved_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (asset_id, price_date, source_id)
);
-- No currency column: V1 prices are USD by definition of scope.

CREATE TABLE corporate_actions (
  id BIGSERIAL PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES assets(id),
  action_type TEXT NOT NULL
    CHECK (action_type IN ('split','reverse_split','dividend','special_dividend',
                           'spinoff','merger','ticker_change')),
  ex_date DATE NOT NULL, pay_date DATE,
  ratio_num NUMERIC(28,10), ratio_den NUMERIC(28,10),
  cash_amount NUMERIC(28,10),
  source_id INT REFERENCES sources(id),
  applied_at TIMESTAMPTZ,     -- when reflected in the ledger
  notes TEXT,
  UNIQUE (asset_id, action_type, ex_date)
);
```

### 3.1 Split-corruption guard *(new in v1.2)*

With no fundamentals layer to cross-check, the vendor's corporate-action feed is the only defence against a split silently corrupting the ledger. A nightly rule:

```
For each held asset:
    ratio = close(T-1) / close(T)   using UNADJUSTED closes
    if ratio is within 2% of a common split ratio (2, 3, 4, 1.5, 0.5, 0.1, …)
       AND no corporate_action exists for that asset with ex_date = T
       AND no comparable move exists in the asset's benchmark
    → raise data_quality_flag('possible_unrecorded_split', severity='error')
    → mark the position value suspect in the UI until resolved
```

Heuristic and occasionally noisy — deliberately. A false positive costs one dismissal; a false negative costs a portfolio value wrong by 4× until you happen to notice.

### 3.2 SGD display rate — the entire FX subsystem

```sql
CREATE TABLE fx_spot_latest (
  base_ccy   CHAR(3) NOT NULL,
  quote_ccy  CHAR(3) NOT NULL,
  rate       NUMERIC(28,10) NOT NULL,
  rate_timestamp TIMESTAMPTZ NOT NULL,   -- as reported by the source
  source_id  INT NOT NULL REFERENCES sources(id),
  retrieved_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (base_ccy, quote_ccy)
);
-- ONE ROW per pair. Upserted. No history. In V1, one row total: ('USD','SGD').
```

**This table replaces the entire v1.1 FX subsystem** — `fx_fixings`, the LOCF resolver, staleness thresholds, exact/carried/stale/missing statuses, recorded-computation refusal logic, execution-vs-reference rate kinds, and the FX leg model.

**Usage rules, enforced in code:**

```
sgdDisplay(usdAmount):
    row = SELECT * FROM fx_spot_latest WHERE base='USD' AND quote='SGD'
    if row is null            → return { available: false }
    return { available: true, value: usdAmount * row.rate,
             rate: row.rate, source: row.source, as_of: row.rate_timestamp }
```

**Hard constraints:**
- Called **only** from render paths. Never from a job, never from a calculation, never from an export-as-truth path.
- **The result is never written to any table.** Asserted by AC-SGD2: no persisted row anywhere contains an SGD monetary value.
- `{ available: false }` renders the string "SGD conversion unavailable". **It is not an error, does not raise a flag, does not fail a job, and does not block a page.**
- The refresh job may fail without consequence. It is the only job in the system with no failure escalation, deliberately.

---

## 4. Ledger `[M1]`

### 4.1 The model, and why it is one table

v1.1 used `transaction_groups` + `transaction_legs` with a cross-row balance invariant. That structure existed to make malformed **multi-currency** events unpersistable. With USD-only accounting the invariant collapses to single-row arithmetic, so the two-table structure would remain while the problem it solved has been deleted. *Full reasoning in Critical Review v1.2 §0.5.*

**One table, plus a nullable `link_id` for the two events that genuinely need two rows: inter-account transfer and spin-off.**

```sql
CREATE TYPE txn_type AS ENUM (
  'BUY','SELL','DIVIDEND','INTEREST','FEE',
  'DEPOSIT','WITHDRAWAL','TRANSFER_OUT','TRANSFER_IN',
  'SPLIT_ADJUSTMENT','SPINOFF_ADJUSTMENT','ADJUSTMENT'
);

CREATE TABLE transactions (
  id              BIGSERIAL PRIMARY KEY,
  account_id      INT NOT NULL REFERENCES accounts(id),
  asset_id        BIGINT REFERENCES assets(id),   -- NULL for pure cash movements
  txn_type        txn_type NOT NULL,
  trade_date      DATE NOT NULL,
  settle_date     DATE,

  quantity        NUMERIC(28,10),        -- signed; NULL for cash-only rows
  price_usd       NUMERIC(28,10),        -- per unit
  gross_amount_usd NUMERIC(28,10),       -- quantity * price, or dividend gross
  fees_usd        NUMERIC(28,10) NOT NULL DEFAULT 0,
  tax_usd         NUMERIC(28,10) NOT NULL DEFAULT 0,   -- dividend withholding
  cash_effect_usd NUMERIC(28,10) NOT NULL,             -- signed change to account cash

  link_id         BIGINT,                -- shared by rows of one multi-row event
  link_role       TEXT CHECK (link_role IN ('transfer_out','transfer_in',
                                            'spinoff_parent','spinoff_child')),

  reverses_id     BIGINT REFERENCES transactions(id),
  reversal_reason TEXT,

  corporate_action_id BIGINT REFERENCES corporate_actions(id),
  note            TEXT,                  -- optional, never required, never flagged

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (reverses_id IS NULL OR reversal_reason IS NOT NULL),
  CHECK (link_id IS NULL OR link_role IS NOT NULL)
);
CREATE INDEX ON transactions (account_id, asset_id, trade_date);
CREATE INDEX ON transactions (link_id) WHERE link_id IS NOT NULL;
CREATE INDEX ON transactions (trade_date DESC);
```

**Append-only, enforced by trigger:** `UPDATE` and `DELETE` raise. Corrections insert reversing rows. Reversing a linked event reverses every row sharing the `link_id`, in one database transaction.

### 4.2 Cash effect — computed, not entered

Validated in the application before insert and shown to the user before commit:

| Type | `cash_effect_usd` |
|---|---|
| `BUY` | `−(quantity × price_usd) − fees_usd` |
| `SELL` | `+(quantity × price_usd) − fees_usd` |
| `DIVIDEND` | `+gross_amount_usd − tax_usd` |
| `INTEREST` | `+gross_amount_usd − tax_usd` |
| `FEE` | `−fees_usd` |
| `DEPOSIT` / `WITHDRAWAL` | `+/− gross_amount_usd` |
| `TRANSFER_OUT`/`IN` (securities) | `0` |
| `TRANSFER_OUT`/`IN` (cash) | `−/+ gross_amount_usd` |
| `SPLIT_ADJUSTMENT` | `0` |
| `SPINOFF_ADJUSTMENT` | `0` |
| `ADJUSTMENT` | user-specified, reason required |

**Dividend withholding is a column on the dividend row, not a second transaction.** v1.1 modelled it as a separate leg; one row with `gross_amount_usd` and `tax_usd` is clearer, cannot desynchronise, and makes net income a single-column read.

### 4.3 Worked examples

**Buy 50 AAPL @ $200, $2 commission, IBKR**
```
BUY · acct=IBKR · asset=AAPL · qty=+50 · price=200
     gross=10000 · fees=2 · cash_effect=-10002 · link_id=NULL
```

**Dividend $120 gross, $36 withheld**
```
DIVIDEND · acct=IBKR · asset=AAPL · qty=NULL · price=NULL
     gross=120 · tax=36 · cash_effect=+84 · link_id=NULL
```

**4-for-1 split**
```
SPLIT_ADJUSTMENT · acct=IBKR · asset=AAPL · qty=+150 · cash_effect=0
     corporate_action_id=<split> · (quantity 50 → 200; avg cost ÷4; total cost unchanged)
```

**Transfer 100 MSFT, IBKR → Schwab** — the case requiring two rows
```
link_id = 4471
  TRANSFER_OUT · acct=IBKR   · asset=MSFT · qty=-100 · cash_effect=0 · role='transfer_out'
  TRANSFER_IN  · acct=SCHWAB · asset=MSFT · qty=+100 · cash_effect=0 · role='transfer_in'
Cost basis carries. No realised P&L. Invariant: Σ quantity over the link = 0.
```

**Spin-off** — the other multi-row case
```
link_id = 4472
  SPINOFF_ADJUSTMENT · asset=PARENT · qty=0    · role='spinoff_parent'  (cost basis reduced)
  SPINOFF_ADJUSTMENT · asset=CHILD  · qty=+25  · role='spinoff_child'   (cost basis assigned)
Invariant: total cost basis across the link is conserved.
```

### 4.4 Link invariants

```
transfer:  Σ quantity over link_id = 0, exactly two rows, same asset_id,
           different account_id, both cash_effect = 0 (securities)
spinoff:   exactly two rows, cost basis conserved across the link
reversal:  reversing a link_id reverses all its rows atomically
```

### 4.5 Derived state

```sql
CREATE TABLE positions_current (
  account_id INT NOT NULL REFERENCES accounts(id),
  asset_id   BIGINT NOT NULL REFERENCES assets(id),
  quantity NUMERIC(28,10) NOT NULL,
  cost_basis_usd NUMERIC(28,10) NOT NULL,
  avg_cost_usd   NUMERIC(28,10),
  realised_pl_usd NUMERIC(28,10) NOT NULL DEFAULT 0,
  first_acquired DATE,
  computed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, asset_id)
);

CREATE TABLE account_cash (
  account_id INT PRIMARY KEY REFERENCES accounts(id),
  cash_usd NUMERIC(28,10) NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE positions_daily (
  snapshot_date DATE NOT NULL,
  account_id INT NOT NULL REFERENCES accounts(id),
  asset_id   BIGINT NOT NULL REFERENCES assets(id),
  quantity NUMERIC(28,10) NOT NULL,
  price_usd NUMERIC(28,10),
  price_source_id INT REFERENCES sources(id),
  price_date DATE,                 -- may lag snapshot_date; drives staleness UI
  market_value_usd NUMERIC(28,10),
  cost_basis_usd NUMERIC(28,10),
  PRIMARY KEY (snapshot_date, account_id, asset_id)
);

CREATE TABLE account_cash_daily (
  snapshot_date DATE NOT NULL,
  account_id INT NOT NULL REFERENCES accounts(id),
  cash_usd NUMERIC(28,10) NOT NULL,
  PRIMARY KEY (snapshot_date, account_id)
);

CREATE VIEW positions_aggregate AS
SELECT asset_id,
       SUM(quantity) AS quantity,
       SUM(cost_basis_usd) AS cost_basis_usd,
       COUNT(DISTINCT account_id) AS account_count
FROM positions_current WHERE quantity <> 0 GROUP BY asset_id;
```

**Portfolio totals are aggregations over accounts, never the storage grain.** Every analytics query starts at `(account_id, asset_id)` and aggregates upward; account filtering is a `WHERE` clause, not a separate code path.

**Cash is derived**, not an asset: `cash_usd = SUM(cash_effect_usd)` per account. No `CASH.USD` asset row, no `price = 1.0` special case, no exclusion filter in every allocation query, and no possibility of a cash asset drifting from the cash effects that imply it. *Reasoning in Critical Review v1.2 §0.6.*

### 4.6 Cost basis (per account)

```
BUY   : qty += q ; cost += (q*price + fees) ; avg = cost/qty
SELL  : realised += q*price - fees - q*avg ; cost -= q*avg ; qty -= q ; avg unchanged
SPLIT : qty *= n/d ; avg *= d/n ; cost UNCHANGED              ← property test
XFER  : source qty and cost reduced pro rata; destination increased by the same cost
        no realised P&L                                        ← property test
```
**Average cost only in V1.** Computed per `(account_id, asset_id)`. There is no lot table, no lot selection, and no configuration switch.

**Why FIFO is excluded rather than made optional.** Supporting FIFO properly is not a toggle — it requires lot-level accounting, and lots propagate into partial sales, lot selection policy, transfers between accounts carrying lot identity and acquisition dates, spin-off basis allocation across lots, corporate-action adjustment of every open lot, and per-lot reconciliation. V1 is a personal portfolio-tracking system, not a tax-lot accounting platform, and a half-implemented FIFO is worse than none: it produces numbers that look authoritative and are wrong at exactly the moments they matter.

**The UI must state this plainly:** cost basis here is a portfolio-tracking record, not tax-lot accounting. Singapore does not tax capital gains, so nothing in V1 depends on lot identity.

If true tax-lot accounting is ever needed, it should be designed deliberately as its own piece of work — introducing a `lots` table, a lot-selection policy, and a migration that reconstructs lots from the append-only transaction history. **That reconstruction remains possible precisely because the ledger is append-only and never overwritten**, which is what makes deferring this safe rather than lossy.

### 4.7 Reconciliation

```sql
CREATE TABLE account_reconciliations (
  id BIGSERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id),
  as_of_date DATE NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('total','per_holding')),
  broker_reported JSONB NOT NULL,
  system_computed JSONB NOT NULL,
  max_delta_pct NUMERIC(12,6),
  status TEXT NOT NULL CHECK (status IN ('ok','investigating','resolved')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, as_of_date, scope)
);
```

Reconciliation is meaningless at any grain coarser than the account — which is why the account-grain fix from v1.1 is retained.

---

## 5. Watchlist `[M2]`

```sql
CREATE TABLE watchlist_items (
  id BIGSERIAL PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES assets(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,                    -- OPTIONAL. No length check, no requirement.
  tags TEXT[],                  -- OPTIONAL soft relevance hints
  materiality_threshold TEXT NOT NULL DEFAULT 'important'
     CHECK (materiality_threshold IN ('notable','important')),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON watchlist_items (asset_id) WHERE NOT is_archived;
```

**Deliberately absent, all present in v1.1:** the `reason NOT NULL CHECK (length >= 10)` constraint · `review_date NOT NULL` · `gate0_status` · `price_of_interest_note` · `archive_reason NOT NULL`. V1's watchlist means only *"monitor this asset"*, and every one of those fields encoded an investment-candidate workflow that belongs to V2.

**Archival, not deletion.** The partial unique index permits re-adding a previously archived asset while preserving the old row.

Default materiality threshold for watched assets is `important` — a higher bar than holdings, since you have less at stake.

---

## 6. Material moves `[M2 detection, M3 catalyst]`

**Created in M2, extended in M3.** `material_moves` must not reference `events`, which does not exist until M3.

```sql
-- M2 migration: detection only. NO reference to events.
CREATE TABLE material_moves (
  id BIGSERIAL PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES assets(id),
  move_date DATE NOT NULL,
  pct_change NUMERIC(10,6) NOT NULL,
  threshold_used NUMERIC(6,3) NOT NULL,
  threshold_basis TEXT NOT NULL
     CHECK (threshold_basis IN ('asset_class_default','asset_override','weight_adjusted')),
  portfolio_weight_at NUMERIC(8,4),
  is_holding BOOLEAN NOT NULL,
  catalyst_status TEXT NOT NULL DEFAULT 'pending'
     CHECK (catalyst_status IN ('known','possible','none_found','pending')),
  benchmark_asset_id BIGINT REFERENCES assets(id),
  benchmark_pct_change NUMERIC(10,6),
  acknowledged_at TIMESTAMPTZ,
  user_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, move_date)
);
CREATE INDEX ON material_moves (move_date DESC) WHERE acknowledged_at IS NULL;
```

```sql
-- M3 migration: added once events exists. Nullable — historical M2 moves keep NULL.
ALTER TABLE material_moves
  ADD COLUMN linked_event_id BIGINT REFERENCES events(id);
CREATE INDEX ON material_moves (linked_event_id) WHERE linked_event_id IS NOT NULL;
```

**`assumption_ids` from v1.1 is deleted.** Material moves have no thesis dependency.

**`catalyst_status` defaults to `'pending'`**, which is the complete and correct M2 state — detection ships before the event pipeline exists, so moves are recorded and displayed with no catalyst information. M3 introduces the column and the join, after which the status transitions `pending → known / possible / none_found`.

**Moves detected during M2 are not retroactively explained.** The catalyst join runs forward from the day M3 ships; older moves keep `catalyst_status = 'pending'` and `linked_event_id IS NULL`, and the UI states that no event data was being collected at the time. This is honest and costs nothing — the alternative, backfilling explanations from documents that were never ingested, is not possible and should not be implied.

**The architecture is unchanged: M2 detects moves; M3 explains them where evidence exists.**

### 6.1 Detection

```
Runs after prices_eod succeeds. If prices_eod failed or the price is stale,
DO NOT RUN — a stale price produces a phantom move.

threshold = assets.move_threshold_pct
         ?? class default (equity 5.0, etf 3.0, crypto 8.0)

optional weight adjustment (configurable):
    effective = threshold × clamp(1.5 − portfolio_weight_pct/10, 0.6, 1.5)
    → a 5% move in a 12% position qualifies; a 5% move in a 0.3% position may not

if abs(pct_change) >= effective → record
```

**No statistical anomaly detection.** No volatility-adjusted z-scores, no rolling standard deviations. A configurable percentage is legible, debuggable and adequate.

### 6.2 Catalyst join `[M3]` — correlation, never causation

```
window = [move_date − 2 days, move_date + 1 day]
candidates = events linked to this asset within the window

if ∃ event with role='subject' AND significance='important'
    → 'known',    linked_event_id = that event
elif ∃ any linked event
    → 'possible', linked_event_id = best candidate
else
    → 'none_found'
       if benchmark_asset_id has a same-day move with matching sign
          and abs(benchmark) >= 0.6 × abs(asset move)
       → record benchmark_pct_change as context, not as cause
```

**Rendered copy is constrained to correlational language.** "Related company event found: earnings release" — never "fell because of earnings". "Broader technology benchmark moved similarly" — never "this was a market move". The `ai_inference` claim class may not be used to explain a price move at all.

### 6.3 Presentation constraints — enforced, not stylistic

- Material moves enter the attention queue as ordinary capped items.
- **No API endpoint accepts a percentage-change sort parameter.** Tested, because the easiest route to a forbidden interface is the endpoint that enables it.
- Default positions sort is portfolio weight. Daily move is a column, never the anchor.

---

## 7. Documents and events `[M3]`

```sql
CREATE TABLE documents (
  id BIGSERIAL PRIMARY KEY,
  source_id INT NOT NULL REFERENCES sources(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('sec_filing','issuer_pr','news')),
  external_id TEXT NOT NULL,    -- SEC accession / vendor id / derived fallback
  canonical_url TEXT, url_hash TEXT,
  publisher TEXT,
  title TEXT NOT NULL, title_norm TEXT, title_hash TEXT,
  lede_simhash BIGINT,
  published_at TIMESTAMPTZ NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  retrieval_status TEXT NOT NULL
     CHECK (retrieval_status IN ('full','headline_only','paywalled','failed')),
  language CHAR(2) DEFAULT 'en',
  body_text TEXT,               -- nullable by design; see note below. Used by §8.3
  filing_type TEXT,             -- '10-K','10-Q','8-K','S-1','4','SC 13D'
  filing_items TEXT[],          -- 8-K item codes: free structured event typing
  UNIQUE (source_id, external_id),
  CONSTRAINT documents_full_has_body
     CHECK (retrieval_status <> 'full' OR body_text IS NOT NULL)
);
CREATE INDEX ON documents (title_hash);
CREATE INDEX ON documents (url_hash);
CREATE INDEX ON documents (published_at DESC);
```

**No vector column, in V1 or ever, at this table.** Embeddings, if V4 needs them, live in a separate table keyed by document and model.

**`body_text` is retained in Postgres deliberately.** V1 needs it at claim-validation time; V2 needs it for assumption routing. At ~100k documents/year this is a few GB — trivially affordable, and it yields free full-text search. **Discarding it after summarisation would be irreversible.**

**Two nullability decisions worth stating explicitly, since both look like missing `NOT NULL`s:**

- **`body_text` is deliberately nullable.** Documents with `retrieval_status` of `'headline_only'`, `'paywalled'` or `'failed'` have no text, and that is a legitimate, expected state — not missing data. The invariant that actually holds is *full retrieval implies text*, and it is expressed as the `documents_full_has_body` CHECK above rather than left in prose. That constraint is what makes the §8.3 rule — sourced claims are impossible for text-less documents — enforceable rather than aspirational.

- **`external_id` is `NOT NULL`.** The `UNIQUE (source_id, external_id)` constraint is the anchor that makes re-polling idempotent, and in Postgres NULLs do not conflict, so a nullable `external_id` would silently permit unlimited duplicate rows for any news item lacking a vendor ID. Where a source provides no identifier, one is derived deterministically at ingestion:
  ```
  external_id = coalesce(vendor_id, url_hash, left(sha256(title_norm || published_at), 32))
  ```
  Same fallback ladder, same determinism requirement, and same reason as the `event_key` derivation in §7.0.

```sql
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,   -- 'earnings','guidance','8k_material','mgmt_change',
                              -- 'm_and_a','regulatory','product','analyst_action',
                              -- 'insider_transaction','ownership','other'
  event_key TEXT NOT NULL UNIQUE,   -- always present; see §7.0 for derivation
  primary_asset_id BIGINT REFERENCES assets(id),
  occurred_at TIMESTAMPTZ NOT NULL,
  period_label TEXT,          -- prevents cross-period merging
  headline TEXT NOT NULL,
  significance TEXT CHECK (significance IN ('important','notable','routine')),
  cluster_method TEXT NOT NULL
     CHECK (cluster_method IN ('natural_key','near_dup','manual')),
  first_seen_at TIMESTAMPTZ NOT NULL
);
```

`cluster_method` has **no `'embedding'` or `'llm'` members in V1** — those arrive with V4 if semantic clustering is ever justified.

### 7.0 Deterministic `event_key` derivation

`event_key` is `NOT NULL UNIQUE`, so every event needs a key even when no authoritative external identifier exists. The derivation is a four-tier cascade — **deterministic, rule-based, and with no LLM at any tier.**

```
TIER 1 — Regulatory filing (authoritative external key)
    key = "sec:" || accession_number
    e.g. "sec:0000320193-26-000062"

TIER 2 — Vendor event feed with a stable identifier
    key = source_name || ":" || external_id
    e.g. "VENDOR_X:evt_88213"
    Only for feeds whose IDs are documented as stable. A vendor ID that
    changes between polls is worse than no ID — use Tier 3 or 4 instead.

TIER 3 — Scheduled corporate event with a resolvable reporting period
    key = "evt:" || asset_id || ":" || event_type || ":" || period_label
    e.g. "evt:1042:earnings:FY2026Q3"
    period_label is derived from the filing period or the issuer's
    published calendar — never inferred from article text.

TIER 4 — Fallback: news-derived, no natural key available
    key = "doc:" || primary_asset_id || ":" || event_type || ":"
              || occurred_date || ":" || left(sha256(title_norm), 16)
    e.g. "doc:1042:product:2026-08-24:9f2c7a11b430de85"
    occurred_date is the UTC calendar date of publication.
    title_norm is the lowercased, punctuation- and stopword-stripped title
    already stored on documents.
```

**Properties this guarantees:**

- **Deterministic.** The same document re-ingested produces the same key, so re-polling is idempotent and a retry after a crash cannot create a duplicate event.
- **No cross-period merging, at every tier.** Tier 1 keys are unique per filing. Tier 3 carries `period_label`, so Q2 and Q3 earnings can never collide. Tier 4 carries `occurred_date`, so two identically-titled stories on different days are two events. **This preserves the zero-tolerance rule (AC-N3) structurally rather than by convention.**
- **No LLM involvement.** `event_type` at Tiers 3 and 4 is rule-derived — 8-K item code, filing type, or a keyword-to-type mapping table, defaulting to `'other'`. M3 has no AI available, and the key must be computable there.
- **Stable and immutable.** Once assigned, `event_key` is never recomputed. **M4's AI classification writes `significance` only; it may not mutate `event_type` or `event_key`.** If AI classification could change `event_type`, the key would drift and the same real-world event could split in two. A model-proposed type correction is surfaced as a reviewable flag, never applied silently.
- **Intra-day near-duplicates still merge normally.** Tier 4 keys collide by design when the same asset, type, date and normalised title recur — which is exactly the syndication case, and is handled by the Step 2 near-duplicate path in §7.1 before a key is ever generated.

Tier 4 is a *fallback*, not the common path. In practice Tiers 1 and 3 cover filings and scheduled corporate events, which is where most of the material signal lives.

```sql
CREATE TABLE event_documents (
  event_id BIGINT REFERENCES events(id),
  document_id BIGINT REFERENCES documents(id),
  relation TEXT NOT NULL CHECK (relation IN ('primary','followup','syndicated','commentary')),
  PRIMARY KEY (event_id, document_id)
);

CREATE TABLE event_asset_links (
  event_id BIGINT REFERENCES events(id),
  asset_id BIGINT REFERENCES assets(id),
  role TEXT NOT NULL CHECK (role IN ('subject','mentioned','peer')),
  confidence NUMERIC(4,3),
  linker TEXT NOT NULL CHECK (linker IN ('rule','ai','manual')),
  PRIMARY KEY (event_id, asset_id)
);

-- M3 migration: deterministic filtering only. NO reference to ai_runs.
CREATE TABLE document_filters (
  document_id BIGINT PRIMARY KEY REFERENCES documents(id),
  stage TEXT NOT NULL
     CHECK (stage IN ('universe','publisher_tier','syndication','pattern','ai_triage')),
  passed BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  filtered_at TIMESTAMPTZ NOT NULL
);
```

```sql
-- M4 migration: added once ai_runs exists. Nullable — every deterministic
-- filter row written during M3 correctly keeps ai_run_id IS NULL.
ALTER TABLE document_filters
  ADD COLUMN ai_run_id BIGINT REFERENCES ai_runs(id);
```

**M3 filtering is complete without AI.** The `'universe'`, `'publisher_tier'`, `'syndication'` and `'pattern'` stages are all rule-based and cover the deterministic pipeline end to end. The `'ai_triage'` stage value is permitted by the CHECK from M3 onward but is only *written* from M4, at which point `ai_run_id` exists to record which run produced the decision. **The architecture is unchanged: M3 is deterministic ingestion, linking, dedup and filtering; M4 layers AI triage on top.**

**The completeness invariant.** Every document must have either an `event_documents` row or a `document_filters` row. Asserted nightly:

```sql
SELECT d.id FROM documents d
LEFT JOIN event_documents ed ON ed.document_id = d.id
LEFT JOIN document_filters df ON df.document_id = d.id
WHERE ed.document_id IS NULL AND df.document_id IS NULL;
-- must return zero rows
```

This is what makes silence trustworthy, and it costs nothing.

### 7.1 Deduplication — deterministic only

```
STEP 1 — Natural key (Tier 1/2/3 of §7.0)
  SEC filing          → event_key = "sec:" + accession_number
  Vendor stable id    → event_key = source_name + ":" + external_id
  Scheduled corporate → event_key = "evt:" + asset_id + ":" + event_type
                                          + ":" + period_label
  Resolve or create. DONE.
  ** period_label is mandatory in the key. Merging across periods is a
     zero-tolerance correctness defect, not a tunable threshold. **

STEP 2 — Exact / near-duplicate
  candidates = documents published within ±72h where
        url_hash = D.url_hash
     OR title_hash = D.title_hash
     OR hamming(lede_simhash, D.lede_simhash) <= 3
  if found → attach as relation='syndicated'. DONE.

STEP 3 — New event, cluster_method='near_dup',
         event_key from Tier 4 of §7.0:
         "doc:" + asset_id + ":" + event_type + ":" + occurred_date
              + ":" + left(sha256(title_norm), 16)
  Two articles about the same story sharing no URL, title or lede similarity
  appear as two events. Accepted V1 limitation.

STEP 4 — Manual "same event" merge action, cluster_method='manual'.
         The surviving event retains its original event_key; the merged
         event's documents are re-pointed. Keys are never rewritten.
```

**Not in V1:** embeddings, cosine thresholds, LLM adjudication, clustering-backed merge/split tooling, dedup precision/recall evaluation sets. Deferred to V4 and **only if real usage proves the need.**

### 7.2 Entity linking — rule-first

```
1. Vendor-supplied tickers → validate against the universe; drop unknowns.
2. Exact ticker match with word boundaries PLUS a disambiguating signal
   ($ prefix, parenthetical, exchange qualifier). Guards against
   'IT', 'ALL', 'ON', 'KEY', 'A' false positives.
3. Alias dictionary; skip is_ambiguous aliases unless a second signal is present.
4. CIK match for filings — exact and authoritative.
5. AI disambiguation (M4) only when rules are ambiguous, only among
   universe candidates, confidence recorded.
6. Below threshold → "possibly relevant" tray, not the main queue.
```

---

## 8. AI `[M4]`

```sql
CREATE TABLE ai_runs (
  id BIGSERIAL PRIMARY KEY,
  task_name TEXT NOT NULL,      -- 'triage','summarise','classify','disambiguate'
  prompt_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  input_ref JSONB,
  raw_output TEXT,
  parsed_output JSONB,
  validation_status TEXT NOT NULL
     CHECK (validation_status IN ('passed','rejected_numeric','rejected_schema',
                                  'rejected_excerpt','error')),
  validation_detail TEXT,
  input_tokens INT, output_tokens INT,
  cost_usd NUMERIC(12,6), latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON ai_runs (input_hash, task_name, prompt_version, model_id);

CREATE TABLE ai_claims (
  id BIGSERIAL PRIMARY KEY,
  ai_run_id BIGINT NOT NULL REFERENCES ai_runs(id),
  event_id BIGINT REFERENCES events(id),
  claim_index SMALLINT NOT NULL,
  claim_text TEXT NOT NULL,
  claim_class TEXT NOT NULL CHECK (claim_class IN
     ('structured_data','company_statement','third_party_reporting','ai_inference')),
  document_id BIGINT REFERENCES documents(id),
  excerpt TEXT,
  excerpt_verified BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (claim_class = 'ai_inference'
         OR (document_id IS NOT NULL AND excerpt IS NOT NULL))
);
```

### 8.1 Triage rubric — monitoring-oriented

```json
{"significance": "important | notable | routine | duplicate | unrelated",
 "event_type": "<enum>",
 "rationale": "<no numerals permitted>",
 "confidence": "low | medium | high"}
```

| Class | Meaning | Behaviour |
|---|---|---|
| `important` | A development someone monitoring this asset should see today | Attention queue |
| `notable` | Potentially relevant; worth a glance | Event inbox, not the queue |
| `routine` | Scheduled, procedural or minor | Filed, not surfaced |
| `duplicate` | Same event already surfaced | Attached to the existing event |
| `unrelated` | Not actually about this asset despite the tag | Filtered, link corrected |

**The default is `routine`.** The rubric states explicitly that most market output is noise.

**The phrase "no fundamental impact" does not appear anywhere in a V1 prompt.** It implies a thesis-aware judgement V1 is not permitted to make.

### 8.2 Unsourced numeric-output guardrail

Figures reach the model only as tokens from a pre-computed bundle:

```json
{"tokens":[{"token":"P1","label":"closing price","value":178.42,"unit":"USD",
            "period":"2026-08-22","source":"VENDOR_X","as_of":"2026-08-23T20:00:00Z"}]}
```

Prompt instruction: reference figures only as `{{P1}}`; write no numerals.

```
1. Parse against the task schema.                    fail → rejected_schema
2. Extract every digit sequence from free-text fields.
3. Allowed: inside {{token}}; 4-digit years 1900–2099; quarter labels; list ordinals < 10.
4. Anything else                                      → rejected_numeric
5. Any {{token}} absent from the bundle               → rejected_numeric
6. On rejection: suppress output entirely, log, increment health counter,
   render the source documents alone.
```

**Scope, stated precisely:** *unsupported raw numeric figures do not reach the user.* It does **not** guarantee prose is correct — "revenue nearly doubled" and "one of the largest customers" pass cleanly and can be false. §8.3 narrows the gap; it does not close it.

**Field allow-list.** The bundle builder enforces what may enter a prompt. **Position quantities, cost basis and account values are excluded by default** — enforced in code, asserted in tests. The model needs document text and asset identity; it does not need to know how much you own.

### 8.3 Claim provenance validation

```
For every claim with claim_class <> 'ai_inference':
    document_id must exist                                     else reject claim
    excerpt must be a LITERAL SUBSTRING of documents.body_text
        (after whitespace normalisation and case folding)       else reject claim
    set excerpt_verified = TRUE

If ANY sourced claim fails  → drop that claim.
If ALL sourced claims fail  → suppress the summary, log 'rejected_excerpt'.
```

Deterministic, model-free, microseconds. **A model cannot fabricate a citation that survives a substring test.**

Documents with `retrieval_status = 'headline_only'` or `'paywalled'` have no `body_text`, so **sourced claims cannot be made about them at all** — only the headline is displayed, attributed to the publisher, with no AI summary. This is correct behaviour, not a limitation to work around.

**Soft lint, warn only:** inference claims containing quasi-quantitative language ("doubled", "sharply", "significantly", "largest") are surfaced as *unquantified characterisation*. A nudge, not a gate.

**Residual risk left explicit:** a correctly-classed inference claim with no numerals can still be wrong and still sound authoritative. The mitigations are the label and your scepticism. There is no engineering fix in V1, and claiming otherwise would be the overclaim this design already corrected once.

### 8.4 Caching and cost

Cache on `(task_name, prompt_version, model_id, input_hash)` — re-triaging a document is free. Batch API for scheduled triage. Monthly cap with an ordered ladder: **summaries degrade before triage**, because losing triage means losing the product's core function while losing summaries only means reading the source.

### 8.5 Explicitly removed from v1.1

`GatedAIPanel` and its API-layer 403 · rationale-before-summary gating · assumption-scope proposals · thesis-impact verdict suggestion · bear-narrative generation · the "no fundamental impact" default verdict.

---

## 9. Background jobs

Schedules stored in UTC, computed from an **exchange calendar**, never fixed offsets — US DST alone would otherwise cause a recurring one-hour drift.

| Job | SGT | Milestone | Failure behaviour |
|---|---|---|---|
| `backup_dump` | 03:00 | M1 | **Alert loudly** |
| `prices_eod` | 05:30 | M1 | Retry ×3; stale banner; no day-change; **material moves suppressed** |
| `corporate_actions_poll` | 05:45 | M1 | Flag |
| `positions_snapshot` | 06:00 | M1 | Critical — alert |
| `split_guard` | 06:10 | M1 | Raises `possible_unrecorded_split` |
| `dq_sweep` | 06:20 | M1 | — |
| **`fx_spot_refresh`** | 06:30 | M2 | **None. Silent. Stale or missing rate → "SGD conversion unavailable". The only job with no escalation, deliberately** |
| `material_moves` | 06:15 | M2 | Skipped entirely if `prices_eod` failed |
| `edgar_poll` | every 20 min | M3 | Retry; coverage reduced and stated |
| `news_poll` | hourly | M3 | Same |
| `event_pipeline` | every 30 min | M3 | Documents remain unprocessed, never lost |
| `catalyst_join` | 07:00 | M3 | Moves stay `pending` |
| `ai_triage` | hourly, batched | M4 | Backlog stated in the brief |
| `daily_brief` | 07:45 | M4 | Alert if unsent |

```sql
CREATE TABLE job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running','success','partial','failed')),
  records_in INT, records_out INT,
  coverage JSONB,         -- {sources_polled:[], window:{}, counts:{}}
  error_detail TEXT
);

CREATE TABLE data_quality_flags (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL, entity_id BIGINT,
  rule TEXT NOT NULL,     -- 'stale_price','missing_price','possible_unrecorded_split',
                          -- 'account_reconciliation','non_usd_asset_held',
                          -- 'ai_numeric_rejection','ai_excerpt_rejection',
                          -- 'concentration_breach','orphan_document','ingestion_failure'
  severity TEXT NOT NULL CHECK (severity IN ('info','warn','error')),
  detail TEXT,
  raised_at TIMESTAMPTZ NOT NULL, resolved_at TIMESTAMPTZ
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL, row_id BIGINT NOT NULL,
  action TEXT NOT NULL, actor TEXT NOT NULL,
  before JSONB, after JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Note the absence of an `fx_missing` flag.** In v1.1 a missing rate raised an error and refused computations. In v1.2 a missing rate is a display string. That difference is the whole point of the FX simplification.

---

## 10. API design

REST, JSON.

```
# Portfolio & accounts                                            [M1]
GET    /api/dashboard?account_id=
GET    /api/accounts
GET    /api/accounts/{id}/positions
GET    /api/accounts/{id}/cash
POST   /api/accounts/{id}/reconciliations
GET    /api/portfolio/positions?account_id=      # omit → aggregate
GET    /api/portfolio/allocation?by=account|class|sector
GET    /api/portfolio/concentration              # includes etf_lookthrough_excluded flag
GET    /api/portfolio/history?from=&to=

# Ledger                                                          [M1]
POST   /api/transactions                          # single row, or linked pair
GET    /api/transactions?account_id=&asset_id=&from=&to=
POST   /api/transactions/{id}/reverse             # {reason} required
POST   /api/corporate-actions

# Assets & watchlist                                              [M1/M2]
GET    /api/assets/{id}
GET    /api/assets/{id}/prices?from=&to=
PATCH  /api/assets/{id}                           # sector override, move threshold, tags
GET    /api/watchlist?include_archived=false
POST   /api/watchlist                             # {asset} only; note/tags optional
POST   /api/watchlist/{id}/archive

# Display FX                                                      [M2]
GET    /api/fx/display?base=USD&quote=SGD
       → {available: true,  rate, source, as_of}
       → {available: false}                       # 200 OK, not an error status

# Moves & events                                                  [M2/M3]
GET    /api/material-moves?date=&acknowledged=false
POST   /api/material-moves/{id}/acknowledge
GET    /api/events?from=&significance=
GET    /api/events/{id}
GET    /api/documents/filtered?date=
POST   /api/events/merge

# AI                                                              [M4]
GET    /api/events/{id}/summary                   # claims[], classed and cited. NO GATE.
GET    /api/brief?date=
GET    /api/ai/health                             # rejections, spend, cap status

# Ops                                                             [M1]
GET    /api/health/data
GET    /api/health/jobs
GET    /api/export
```

**Every response containing a figure carries a parallel provenance object:**

```json
{"market_value_usd": {"value": 125430.22, "currency": "USD",
  "as_of": "2026-08-22T20:00:00Z",
  "provenance": {"price_source":"VENDOR_X","price_date":"2026-08-22",
                 "derived":true,"formula_version":"mv.v1"}}}
```

**API-layer enforcement:**
- **No positions or events endpoint accepts `sort=pct_change`** — asserted in tests.
- `/api/fx/display` returns **200 with `available: false`** when the rate is missing. Never 4xx, never 5xx — an FX failure must not look like an error anywhere in the stack.
- `/api/events/{id}/summary` has **no gating precondition of any kind**. Asserted by AC-AI5.

---

## 11. What V2/V3/V4 attach to *(design only — build nothing)*

| Future object | Attaches to | Nothing needed in V1 beyond |
|---|---|---|
| `theses` | `assets.id` | Stable, non-reused asset IDs |
| `thesis_assumptions` | `theses.id` | — |
| `assumption_observations` | `events.id`, `assumptions.id` | Stable event IDs; retained `body_text` |
| `decisions` | `assets.id`, `accounts.id`, `transactions.id` | Stable transaction IDs; append-only history |
| `fundamental_facts` | `assets.id`, `sec_cik` | `sec_cik` already populated |
| `derived_metrics` | `assets.id` | — |
| `valuation_runs` | `assets.id`, `theses.id` | — |
| `scenarios` | `valuation_runs.id` | — |
| `predictions` | `assets.id`, `assumptions.id`, `decisions.id` | — |
| `etf_holdings` | `assets.id` (both sides) | Assets exist for both ETF and constituents |
| `document_embeddings` | `documents.id` | Retained `body_text` |

**The five rules that make this work, all cheap and all in force from M1:**
1. Stable `BIGSERIAL` surrogate keys, never reused, never derived from mutable natural keys.
2. Archive, never delete — a future thesis pointing at an asset you stopped following must still resolve.
3. Retain `documents.body_text` permanently.
4. Keep `assets.native_currency` and `quote_currency`.
5. **Create no empty future tables.** The attachment points are the IDs.

---

## 12. Testing

**Golden-file ledger fixture — written before ledger code.** Must include: 100 shares @ $50 → 4-for-1 split → buy 200 @ $15 → sell 150 @ $20 → dividend $120 gross with $36 withheld → **the same asset held in a second account** → **an inter-account transfer** → a deposit → a fee. Hand-verified once; asserted forever; per account and in aggregate.

**The fixture discriminates between accounting methods by construction.** After the split and the second buy the position holds 600 shares at a blended average of $13.333̅; selling 150 at $20 realises $1,000 under average cost and a different figure under FIFO. **A silent FIFO implementation therefore fails the golden fixture rather than passing it quietly** — which is the property that makes "average cost only" a tested guarantee rather than a documented intention.

**Property tests:**
- Cash per account = `SUM(cash_effect_usd)` = `account_cash.cash_usd` = daily snapshot
- `Σ(position market value) + cash`, per account, = account total; `Σ accounts` = portfolio total
- Split invariance: total cost basis unchanged for any ratio
- Transfer invariance: `Σ quantity` over a `link_id` = 0; cost basis conserved; zero realised P&L
- Reversal invariance: a row plus its reversal returns positions and cash to the prior state exactly
- Linked reversal: reversing one row of a linked pair reverses both, atomically
- Append-only: `UPDATE`/`DELETE` raise
- No sequence of transactions yields negative quantity or negative cost basis
- Cash effect matches the computed value for every transaction type
- **Average-cost only:** a sell after two buys at different prices realises P&L against the blended average, never against a first-in lot. Asserted with a fixture whose FIFO and average-cost answers differ, so a silent FIFO implementation would fail the test
- **No lot-level state exists:** no `lots` table, no lot identifier on any row, no lot-selection parameter on any endpoint

**`event_key` tests (M3):**
- Every `events` row has a non-null key; the column is `NOT NULL`
- Re-ingesting the same document produces the same key and creates no second event (idempotence)
- **Q2 and Q3 earnings for the same asset produce different keys** — Tier 3 period component
- Two identically-titled articles about the same asset on different dates produce different keys — Tier 4 date component
- Key generation runs with no AI available, and `event_type`/`event_key` are unchanged by any M4 AI run

**Migration-sequencing tests:**
- Each migration applies to an empty database in sequence M1 → M2 → M3 → M4 with no errors
- **M1 applies alone**; M2 applies on M1 alone; M3 on M1+M2 alone; M4 on M1+M2+M3
- After M2 alone, `material_moves` has no `linked_event_id` column and inserts succeed with `catalyst_status` defaulting to `'pending'`
- After M3 alone, `document_filters` has no `ai_run_id` column and deterministic filter rows insert successfully
- Every `DEFAULT` satisfies its column's `CHECK` — asserted by inserting a row using only defaults for every table that has both

**SGD failure-injection tests (AC-SGD1, AC-SGD2):**
- Disable the FX source → dashboard renders complete, correct USD figures plus "SGD conversion unavailable"
- No job fails; no data-quality flag is raised; no endpoint returns non-200
- Grep the schema: **no column anywhere stores an SGD monetary value**

**Corporate-action tests:** a split with a recorded action applies correctly · a price series adjusting with no recorded action raises `possible_unrecorded_split` · a ticker change preserves history via `asset_id`.

**Sort-parameter tests:** every list endpoint rejects or ignores `sort=pct_change`.

**Evaluation sets (version-controlled):** entity linking ≥200 documents (M3) · relevance triage ≥200 documents (M4).

**Adversarial numeric set** ≥200 prompts (M4) — zero leakage to UI.

**Claim-excerpt injection tests** (M4) — fabricated, paraphrased and truncated excerpts rejected 100% of the time; headline-only documents produce no sourced claims.

**Material-move tests:** move + same-day 8-K → `known` · move with no event and a comparable benchmark move → `none_found` with benchmark context and **no causal string in any rendered output** · failed `prices_eod` → **zero moves recorded** · moves function with no thesis table present.

**Absence tests** *(new in v1.2, and worth the trouble)*:
- No migration creates a thesis, assumption, decision, fundamentals, valuation or FX-fixings table
- No code path calls an XBRL/companyfacts endpoint
- No AI prompt template contains the string "thesis", "assumption" or "fundamental impact"
- `/api/events/{id}/summary` succeeds with an empty database of everything except documents and events

**Failure-injection tests:** kill each job and assert the UI degrades per PRD D4. This is how error states become real rather than aspirational.

---

## 13. UI component structure

```
app/
  (dashboard)/page.tsx
  accounts/page.tsx
  assets/[id]/page.tsx
  watchlist/page.tsx
  transactions/page.tsx
  events/page.tsx
  moves/page.tsx
  brief/page.tsx
  health/page.tsx
  settings/page.tsx

components/
  provenance/  ProvenanceChip · StalenessBadge · SourceTierLabel
  portfolio/   ValueHeader (USD primary, SGD secondary+approximate) ·
               AccountSelector · AllocationChart ·
               PositionsTable (default sort = weight) ·
               ConcentrationPanel (with mandatory ETF limitation notice)
  ledger/      TransactionForm (computes cash effect) · TransferForm ·
               ReversalDialog · CorporateActionForm · ReconciliationForm
  events/      AttentionQueue (capped, designed empty state) · EventCard ·
               FilteredTray · CoverageNotice
  moves/       MaterialMoveCard (catalyst status; correlational copy only)
  ai/          AIBlock ("AI summary — not verified") · ClaimList · RefusalCard
  health/      DataHealthStrip · JobStatusTable
```

**Four components are load-bearing for product integrity and are built before anything that uses them:**

1. **`ProvenanceChip`** — if any figure can render without it, the provenance guarantee is theatre. Enforce with a lint rule forbidding raw numeric interpolation in JSX under `components/portfolio`.
2. **`ValueHeader`** — the USD/SGD hierarchy lives here. SGD must be visually secondary, labelled approximate, and must render an availability-false state without breaking layout.
3. **`ClaimList`** — sourced claims reveal their excerpt on interaction; inference claims render distinctly. **A prose-only AI rendering path must not exist**, or the claim structure is decorative.
4. **`ConcentrationPanel`** — carries the ETF look-through limitation notice whenever an ETF is held. A concentration warning that silently understates risk is worse than none.

**Removed from v1.1:** `GatedAIPanel`, `FxAgeBadge`, `ThesisEditor`, `AssumptionCard`, `ThesisDiff`, `ReviewPrompt`, `VerdictControl`, `DecisionForm`, `DecisionTimeline`, `JournalNote`, `LookThroughPanel`.

---

## 14. Security implementation

- WebAuthn passkey primary, TOTP fallback, **no registration endpoint in the built application**.
- Short-lived httpOnly SameSite=Strict secure session cookies.
- CSP `default-src 'self'`; no third-party origins on any portfolio-rendering route.
- Audit triggers on `transactions`, `accounts`, `watchlist_items`, `corporate_actions`.
- Prompt payloads governed by an explicit field allow-list in the bundle builder; **position quantities, cost basis and account values excluded by default and asserted in tests**.
- Platform-managed Postgres backups **plus** an independent encrypted nightly `pg_dump` to a different provider. Restore verified pre-launch and quarterly.
- Vendor keys in the platform secret manager, rotated on a calendar reminder.
