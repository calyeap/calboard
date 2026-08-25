-- 001_portfolio_core.sql
-- Full M1 schema per docs/spec/03-TDD-v1.2.md §1.1, §2, §3, §4.
-- Applied in dependency order. Do not reorder — later objects reference earlier ones.

CREATE TYPE asset_class AS ENUM ('equity','etf','crypto');
CREATE TYPE txn_type AS ENUM (
  'BUY','SELL','DIVIDEND','INTEREST','FEE',
  'DEPOSIT','WITHDRAWAL','TRANSFER_OUT','TRANSFER_IN',
  'SPLIT_ADJUSTMENT','SPINOFF_ADJUSTMENT','ADJUSTMENT'
);

-- 1. sources
CREATE TABLE sources (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  reliability_tier SMALLINT NOT NULL,
  terms_url TEXT
);

-- 2. assets
CREATE TABLE assets (
  id                 BIGSERIAL PRIMARY KEY,
  asset_class        asset_class NOT NULL,
  primary_symbol     TEXT NOT NULL,
  exchange_mic       TEXT,
  name               TEXT NOT NULL,
  native_currency    CHAR(3) NOT NULL DEFAULT 'USD',
  quote_currency     CHAR(3) NOT NULL DEFAULT 'USD',
  country            CHAR(2),
  sector             TEXT,
  sector_source_id   INT REFERENCES sources(id),
  sector_overridden  BOOLEAN NOT NULL DEFAULT FALSE,
  industry           TEXT,
  sec_cik            TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  move_threshold_pct NUMERIC(6,3),
  benchmark_asset_id BIGINT REFERENCES assets(id),
  tags               TEXT[],
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON assets (primary_symbol, COALESCE(exchange_mic,''));
CREATE INDEX ON assets (sec_cik) WHERE sec_cik IS NOT NULL;

-- 3. asset_identifiers
CREATE TABLE asset_identifiers (
  asset_id BIGINT REFERENCES assets(id) ON DELETE RESTRICT,
  scheme   TEXT NOT NULL,
  value    TEXT NOT NULL,
  valid_from DATE, valid_to DATE,
  PRIMARY KEY (asset_id, scheme, value)
);

-- 4. asset_aliases
CREATE TABLE asset_aliases (
  asset_id     BIGINT REFERENCES assets(id) ON DELETE CASCADE,
  alias        TEXT NOT NULL,
  alias_type   TEXT NOT NULL,
  is_ambiguous BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (asset_id, alias)
);

-- 5. asset_attributes_equity / _etf / _crypto
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

-- 6. accounts
CREATE TABLE accounts (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  custodian  TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. prices_daily
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

-- 8. corporate_actions
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
  applied_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE (asset_id, action_type, ex_date)
);

-- 9. transactions
CREATE TABLE transactions (
  id              BIGSERIAL PRIMARY KEY,
  account_id      INT NOT NULL REFERENCES accounts(id),
  asset_id        BIGINT REFERENCES assets(id),
  txn_type        txn_type NOT NULL,
  trade_date      DATE NOT NULL,
  settle_date     DATE,

  quantity        NUMERIC(28,10),
  price_usd       NUMERIC(28,10),
  gross_amount_usd NUMERIC(28,10),
  fees_usd        NUMERIC(28,10) NOT NULL DEFAULT 0,
  tax_usd         NUMERIC(28,10) NOT NULL DEFAULT 0,
  cash_effect_usd NUMERIC(28,10) NOT NULL,

  link_id         BIGINT,
  link_role       TEXT CHECK (link_role IN ('transfer_out','transfer_in',
                                            'spinoff_parent','spinoff_child')),

  reverses_id     BIGINT REFERENCES transactions(id),
  reversal_reason TEXT,

  corporate_action_id BIGINT REFERENCES corporate_actions(id),
  note            TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (reverses_id IS NULL OR reversal_reason IS NOT NULL),
  CHECK (link_id IS NULL OR link_role IS NOT NULL)
);
CREATE INDEX ON transactions (account_id, asset_id, trade_date);
CREATE INDEX ON transactions (link_id) WHERE link_id IS NOT NULL;
CREATE INDEX ON transactions (trade_date DESC);

-- Append-only enforcement (TDD §4.1, AC-L5)
CREATE OR REPLACE FUNCTION prevent_transaction_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'transactions is append-only: % is not permitted (id=%)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_append_only
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_transaction_mutation();

-- 10. positions_current
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

-- 11. account_cash
CREATE TABLE account_cash (
  account_id INT PRIMARY KEY REFERENCES accounts(id),
  cash_usd NUMERIC(28,10) NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL
);

-- 12. positions_daily
CREATE TABLE positions_daily (
  snapshot_date DATE NOT NULL,
  account_id INT NOT NULL REFERENCES accounts(id),
  asset_id   BIGINT NOT NULL REFERENCES assets(id),
  quantity NUMERIC(28,10) NOT NULL,
  price_usd NUMERIC(28,10),
  price_source_id INT REFERENCES sources(id),
  price_date DATE,
  market_value_usd NUMERIC(28,10),
  cost_basis_usd NUMERIC(28,10),
  PRIMARY KEY (snapshot_date, account_id, asset_id)
);

-- 13. account_cash_daily
CREATE TABLE account_cash_daily (
  snapshot_date DATE NOT NULL,
  account_id INT NOT NULL REFERENCES accounts(id),
  cash_usd NUMERIC(28,10) NOT NULL,
  PRIMARY KEY (snapshot_date, account_id)
);

-- 14. account_reconciliations
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

-- 15. positions_aggregate view
CREATE VIEW positions_aggregate AS
SELECT asset_id,
       SUM(quantity) AS quantity,
       SUM(cost_basis_usd) AS cost_basis_usd,
       COUNT(DISTINCT account_id) AS account_count
FROM positions_current WHERE quantity <> 0 GROUP BY asset_id;

-- 16. job_runs, data_quality_flags, audit_log
CREATE TABLE job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running','success','partial','failed')),
  records_in INT, records_out INT,
  coverage JSONB,
  error_detail TEXT
);

CREATE TABLE data_quality_flags (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL, entity_id BIGINT,
  rule TEXT NOT NULL,
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

-- Reference-data seed: both market-data provider adapters this plan defines
-- (Task 8) get a row here, regardless of which one is active by default —
-- `sources` is reference data, not a fixed enum, so this doesn't touch schema.
INSERT INTO sources (name, kind, reliability_tier) VALUES ('EODHD', 'vendor', 2);
INSERT INTO sources (name, kind, reliability_tier) VALUES ('YAHOO', 'vendor', 3);
