# M1 First Vertical Slice — Portfolio Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get to a real browser view of real holdings and total portfolio value (USD) as fast as practical, on a $0-cost local stack, while laying down the complete, canonical `001_portfolio_core` schema exactly as specified — not a temporary subset.

**Architecture:** Next.js (App Router, TypeScript) talking directly to a local Postgres via `pg`, no ORM. Server Components read the DB directly for the dashboard; two Next.js Server Actions handle the only two writes this slice needs (create account, record a transaction). Money and quantity are `decimal.js` in application code and `NUMERIC(28,10)` in Postgres — never native floats. A swappable `MarketDataProvider` abstraction supplies the one EOD price per held asset, fetched on demand — a free Yahoo-compatible source if Task 7's bounded spike passes, EODHD (already validated in M0) as a fallback adapter either way — no scheduler/worker process yet, no required paid subscription. Everything runs on `localhost`; no deployment, no auth, in this slice.

**Tech Stack:** Next.js 15 (App Router) + TypeScript, PostgreSQL 16 (local, via Docker Compose), `pg` (raw parameterized SQL, no ORM), `decimal.js`, Vitest, `tsx` for standalone scripts.

**Spec:** `docs/spec/` (v1.2, all six files — already read in full this session). `docs/spec/03-TDD-v1.2.md` §1.1, §2, §3, §4 is the authoritative source for every table in this plan's migration. `docs/spec/01-PRD-v1.2.md` §6 (L1–L13) is authoritative for ledger behaviour.

## Global Constraints

- USD is the sole accounting currency in V1 — no currency column on `transactions` or `prices_daily` (PRD CUR1).
- All money and quantity columns are `NUMERIC(28,10)` in Postgres, never floating point (TDD conventions header; TRD §2.2).
- All money math in application code uses `decimal.js`, never native JS numbers (TRD §2.3).
- The ledger is append-only: `UPDATE`/`DELETE` on `transactions` must raise (PRD L4; AC-L5).
- Cost basis is average-cost only, computed per `(account_id, asset_id)` — no lot table, no FIFO, no configuration switch (PRD L8; TDD §4.6).
- Cash is derived as `SUM(cash_effect_usd)` per account — never modelled as an asset (PRD L6; TDD §4.5/§0.6).
- Positions are keyed at `(account_id, asset_id)`; portfolio totals are an aggregation, never the storage grain (PRD L5).
- Every price row carries `source_id` and `retrieved_at` (PRD MD6).
- EOD prices only — no real-time/websocket data (PRD MD1).
- The `001_portfolio_core` migration in this plan is the **full, canonical** schema from TDD §1.1/§2–§4.7, in the documented dependency order — not a temporary subset (explicit user instruction, this session).
- $0 ongoing cost while building: local Postgres via Docker, EODHD free tier, no paid services introduced without a clear need and no free/local alternative (explicit user instruction, this session).
- Secrets live only in `.env.local`, which must remain covered by `.gitignore` before any commit; no task in this plan prints, logs, or overwrites existing secret values (explicit user instruction, this session — `.env.local` already holds real `EODHD_API_KEY`, `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `RENDER_API_KEY` from M0).
- This slice runs on `localhost` only. Do not deploy it to Render or any public host as part of this plan — that is deliberately deferred until WebAuthn/passkey auth (or another explicit decision) is in place (explicit user instruction, this session).
- Market data comes through a swappable `MarketDataProvider` abstraction — a free Yahoo-compatible source is the MVP default (if Task 7's bounded spike passes), EODHD is a swappable fallback adapter, not a required paid dependency. No provider is hardcoded into the application layer (explicit user instruction, this session).
- Every provider has a daily/rate quota risk. Fetch a price only for an asset actually being transacted, reuse a recently-retrieved `prices_daily` row instead of re-fetching, and fail clearly (never auto-retry) if a quota is exhausted — this applies to whichever provider is active, not just EODHD (explicit user instruction, this session).
- Corporate-action data (splits/dividends) from any free/unofficial source must never silently mutate accounting-critical records. This slice's market-data layer only ever writes to `prices_daily`; applying a split or dividend to the ledger stays a separate, explicit `corporate_actions` + manual-transaction path (PRD MD4/MD5, TDD §3.1) that this slice does not build — see "Explicitly out of scope" (explicit user instruction, this session).

## Explicitly out of scope for this slice (deferred to M1 hardening or later)

Reversal flow · account reconciliation · corporate actions applied to the ledger · the split-corruption guard job · `positions_daily`/`account_cash_daily` snapshot jobs · export/backup · WebAuthn/passkey auth (this slice is `localhost`-only) · the formal `/api/*` REST surface from TDD §10 (this slice uses two Server Actions instead — see Task 10) · fundamentals, analyst ratings, ETF holdings data, or news research from the market-data spike (Task 7 is bounded strictly to prices, splits, and dividends) · the M2 three-zone Dashboard, watchlist, SGD display, concentration panel · M3 news/filings · M4 AI. None of these are removed from the product — they are simply not needed to get a first real number on screen, per the user's "smallest end-to-end usable path first, then harden" instruction.

---

### Task 1: Project scaffold, git init, secret handling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `next-env.d.ts`, `app/layout.tsx`
- Verify (no changes if already correct): `.gitignore`, `.env.local` (must not be read or overwritten)

**Interfaces:**
- Produces: a runnable Next.js TypeScript project skeleton (`npm run dev` will work once dependencies are installed in Task 2+).

- [ ] **Step 1: Verify `.gitignore` still covers secrets, without reading `.env.local`**

Run:
```bash
cat .gitignore
```
Expected: contains `.env` and `.env.*` lines (this file was created earlier in the session — if missing, stop and investigate before proceeding, do not recreate blindly).

- [ ] **Step 2: Initialize git**

```bash
git init
git status
```
Expected: `.env.local` does **not** appear in the untracked-files list untracked-but-ignored section is fine; it must not appear as something `git add -A` would pick up. Confirm with:
```bash
git check-ignore -v .env.local
```
Expected: prints a match against `.gitignore`'s `.env.*` line. If this does not print a match, **stop** — do not commit anything until it does.

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "calboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "migrate": "tsx scripts/migrate.ts"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "pg": "^8.13.0",
    "decimal.js": "^10.4.3"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/pg": "^8.11.0",
    "vitest": "^2.1.0",
    "dotenv": "^16.4.5",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Write `next.config.ts`, `next-env.d.ts`, `app/layout.tsx`**

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

`next-env.d.ts`:
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

`app/layout.tsx`:
```tsx
export const metadata = {
  title: "Calboard",
  description: "Private portfolio tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Install dependencies**

```bash
npm install
```
Expected: completes with no errors; `node_modules/` is created (already covered by `.gitignore`).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts next-env.d.ts app/layout.tsx .gitignore
git status
git commit -m "chore: scaffold Next.js TypeScript project"
```
Before committing, re-check `git status` output line by line and confirm `.env.local` is not staged.

---

### Task 2: Local Postgres via Docker Compose

**Files:**
- Create: `docker-compose.yml`, `lib/db.ts`, `lib/decimal.ts`

**Interfaces:**
- Produces: `getPool(): Pool` (from `lib/db.ts`), `toDecimal(value): Decimal | null` and `decimalToDb(value): string | null` (from `lib/decimal.ts`). Every later task's DB code imports `getPool` from here.

- [ ] **Step 1: Docker preflight — verify Docker is installed and running before anything else in this task**

Run:
```bash
docker --version
docker compose version
```
Expected: both print a version number (e.g. `Docker version 27.x.x` and `Docker Compose version v2.x.x`).

**If either command fails or is not found: STOP.** Do not proceed to Step 2, and do not substitute a different database approach (a hosted Postgres, SQLite, a native Windows Postgres install, etc.) without an explicit decision — this plan is written specifically around a local Docker Postgres for zero cost and fast iteration, so silently changing that would violate the plan. Instead, give these setup instructions and wait:

1. Install Docker Desktop for Windows: https://www.docker.com/products/docker-desktop/
2. Docker Desktop requires WSL2. If the installer prompts about it, accept — it will guide you through enabling WSL2 (may require a restart).
3. After installing, open Docker Desktop from the Start menu and wait until it reports "Docker Desktop is running" (the whale icon in the system tray stops animating).
4. Re-run the two commands above. Once both succeed, continue to Step 2.

Also confirm the Docker daemon is actually running (not just installed):
```bash
docker ps
```
Expected: prints an empty table header (`CONTAINER ID   IMAGE   ...`) with no error. If this errors with something like "Cannot connect to the Docker daemon", Docker Desktop is installed but not running — open it, wait for it to finish starting, then retry.

- [ ] **Step 2: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: calboard
      POSTGRES_PASSWORD: calboard_dev_local_only
      POSTGRES_DB: calboard
    ports:
      - "5432:5432"
    volumes:
      - calboard_pgdata:/var/lib/postgresql/data

volumes:
  calboard_pgdata:
```

- [ ] **Step 3: Start Postgres and verify it's reachable**

```bash
docker compose up -d
docker compose ps
```
Expected: `postgres` service shows `running`/`healthy`.

```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "SELECT 1;"
```
Expected: returns a single row with `1`. (If `docker compose` errors with "command not found", use the hyphenated `docker-compose` form instead — everything else is unchanged.)

- [ ] **Step 4: Append `DATABASE_URL` to `.env.local` without reading or overwriting it**

```bash
echo "DATABASE_URL=postgresql://calboard:calboard_dev_local_only@localhost:5432/calboard" >> .env.local
```
This appends one line; it does not touch the existing `EODHD_API_KEY`, `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, or `RENDER_API_KEY` lines already in the file. Verify only that the line count grew by exactly one, without printing contents:
```bash
wc -l .env.local
```

- [ ] **Step 5: Write `lib/decimal.ts`**

```ts
import Decimal from "decimal.js";

export function toDecimal(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  return new Decimal(value);
}

export function decimalToDb(value: Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toFixed(10);
}
```

- [ ] **Step 6: Write `lib/db.ts`**

```ts
import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — check .env.local");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}
```

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml lib/db.ts lib/decimal.ts
git status
git commit -m "feat: local Postgres via Docker Compose + DB pool helper"
```
Re-check `git status` confirms `.env.local` is still not staged.

---

### Task 3: Full `001_portfolio_core` migration

**Files:**
- Create: `migrations/001_portfolio_core.sql`, `scripts/migrate.ts`
- Test: manual verification query (below) — this task has no unit test since it's schema DDL

**Interfaces:**
- Consumes: `getPool` from `lib/db.ts` (Task 2)
- Produces: every table listed in TDD §1.1's M1 migration, in the same dependency order, plus a `schema_migrations` bookkeeping table and two seeded `sources` rows (`'EODHD'`, `'YAHOO'`) for Task 8's provider adapters. All later tasks' SQL assumes these table/column names exactly. Exact object count verified against TDD §1.1 in Step 4/Step 6 below: **19 tables** (`sources`, `assets`, `asset_identifiers`, `asset_aliases`, `asset_attributes_equity`, `asset_attributes_etf`, `asset_attributes_crypto`, `accounts`, `prices_daily`, `corporate_actions`, `transactions`, `positions_current`, `account_cash`, `positions_daily`, `account_cash_daily`, `account_reconciliations`, `job_runs`, `data_quality_flags`, `audit_log`), **1 view** (`positions_aggregate`), **2 enum types** (`asset_class`, `txn_type`), and **1 append-only trigger** on `transactions` (TDD §4.1, AC-L5) — plus `schema_migrations`, which is this plan's own migration-tooling table, not part of the TDD schema.

- [ ] **Step 1: Write the complete migration file**

Create `migrations/001_portfolio_core.sql`:

```sql
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
```

- [ ] **Step 2: Write the migration runner**

Create `scripts/migrate.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set in .env.local");
  }
  const pool = new Pool({ connectionString });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationFile = "001_portfolio_core.sql";
  const already = await pool.query(
    `SELECT 1 FROM schema_migrations WHERE filename = $1`,
    [migrationFile]
  );

  if (already.rows.length > 0) {
    console.log(`${migrationFile} already applied, skipping.`);
    await pool.end();
    return;
  }

  const sql = readFileSync(join(process.cwd(), "migrations", migrationFile), "utf-8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1)`,
      [migrationFile]
    );
    await client.query("COMMIT");
    console.log(`${migrationFile} applied successfully.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run the migration**

```bash
npm run migrate
```
Expected: prints `001_portfolio_core.sql applied successfully.`

- [ ] **Step 4: Verify the schema structurally**

```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "\dt"
```
Expected: lists `account_cash`, `account_cash_daily`, `account_reconciliations`, `accounts`, `asset_aliases`, `asset_attributes_crypto`, `asset_attributes_equity`, `asset_attributes_etf`, `asset_identifiers`, `assets`, `audit_log`, `corporate_actions`, `data_quality_flags`, `job_runs`, `positions_current`, `positions_daily`, `prices_daily`, `schema_migrations`, `sources`, `transactions` (20 tables). Then:
```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "\dv"
```
Expected: lists `positions_aggregate`.
```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "SELECT name, kind, reliability_tier FROM sources ORDER BY name;"
```
Expected: two rows — `EODHD | vendor | 2` and `YAHOO | vendor | 3`.

- [ ] **Step 5: Re-run the migration to confirm idempotence**

```bash
npm run migrate
```
Expected: prints `001_portfolio_core.sql already applied, skipping.` and does not error.

- [ ] **Step 6: Verify the migration applies cleanly to a brand-new database, not just this dev DB**

This proves `001_portfolio_core.sql` is correct and self-contained, not merely "already worked once" against a database that may have accumulated other state.

```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "CREATE DATABASE calboard_migration_check;"
docker exec -i $(docker compose ps -q postgres) psql -U calboard -d calboard_migration_check < migrations/001_portfolio_core.sql
```
Expected: the second command runs every `CREATE TYPE`/`CREATE TABLE`/`CREATE INDEX`/`CREATE TRIGGER`/`CREATE VIEW`/`INSERT` statement with no error output.

Verify the expected M1 objects exist in the clean database:
```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard_migration_check -c "\dt"
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard_migration_check -c "\dv"
```
Expected: the same 19 tables as Step 4 above (everything except `schema_migrations`, which only `scripts/migrate.ts` creates — this raw `psql` path bypasses the runner on purpose, to test the SQL file in isolation), plus the `positions_aggregate` view.

Verify append-only protection exists and actually fires, using a throwaway row:
```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard_migration_check -c "
INSERT INTO accounts (name) VALUES ('check');
INSERT INTO transactions (account_id, txn_type, trade_date, fees_usd, cash_effect_usd)
  VALUES (1, 'DEPOSIT', '2026-01-01', 0, 100);
UPDATE transactions SET note = 'x' WHERE id = 1;
"
```
Expected: both `INSERT`s succeed, then the `UPDATE` fails with the `transactions is append-only` exception — proving the append-only guarantee is present in a migration applied from scratch, not just inherited from earlier manual testing against the dev database.

Clean up the throwaway database so it doesn't linger:
```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "DROP DATABASE calboard_migration_check;"
```

- [ ] **Step 7: Commit**

```bash
git add migrations/001_portfolio_core.sql scripts/migrate.ts
git commit -m "feat: full 001_portfolio_core migration (all M1 tables) + runner, verified clean-apply"
```

---

### Task 4: Cash-effect pure function

**Files:**
- Create: `lib/ledger/cashEffect.ts`
- Test: `lib/ledger/cashEffect.test.ts`

**Interfaces:**
- Produces: `computeCashEffectUsd(input: CashEffectInput): Decimal`, `SupportedTxnType = "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL"`, `CashEffectInput`. Task 6's `applyTransaction` consumes this directly.

- [ ] **Step 1: Write the failing test**

Create `lib/ledger/cashEffect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeCashEffectUsd } from "./cashEffect";

describe("computeCashEffectUsd", () => {
  it("computes BUY as -(qty*price)-fees", () => {
    const result = computeCashEffectUsd({
      txnType: "BUY",
      quantity: new Decimal(50),
      priceUsd: new Decimal(200),
      feesUsd: new Decimal(2),
    });
    expect(result.toFixed(2)).toBe("-10002.00");
  });

  it("computes SELL as +(qty*price)-fees", () => {
    const result = computeCashEffectUsd({
      txnType: "SELL",
      quantity: new Decimal(10),
      priceUsd: new Decimal(150),
      feesUsd: new Decimal(1),
    });
    expect(result.toFixed(2)).toBe("1499.00");
  });

  it("computes DEPOSIT as +grossAmount", () => {
    const result = computeCashEffectUsd({
      txnType: "DEPOSIT",
      feesUsd: new Decimal(0),
      grossAmountUsd: new Decimal(5000),
    });
    expect(result.toFixed(2)).toBe("5000.00");
  });

  it("computes WITHDRAWAL as -grossAmount", () => {
    const result = computeCashEffectUsd({
      txnType: "WITHDRAWAL",
      feesUsd: new Decimal(0),
      grossAmountUsd: new Decimal(500),
    });
    expect(result.toFixed(2)).toBe("-500.00");
  });

  it("throws on BUY without quantity", () => {
    expect(() =>
      computeCashEffectUsd({ txnType: "BUY", feesUsd: new Decimal(0) })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ledger/cashEffect.test.ts`
Expected: FAIL — `cashEffect.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/ledger/cashEffect.ts`:

```ts
import Decimal from "decimal.js";

export type SupportedTxnType = "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL";

export interface CashEffectInput {
  txnType: SupportedTxnType;
  quantity?: Decimal | null;
  priceUsd?: Decimal | null;
  feesUsd: Decimal;
  grossAmountUsd?: Decimal | null;
}

export function computeCashEffectUsd(input: CashEffectInput): Decimal {
  const { txnType, quantity, priceUsd, feesUsd, grossAmountUsd } = input;

  switch (txnType) {
    case "BUY": {
      if (!quantity || !priceUsd) {
        throw new Error("BUY requires quantity and priceUsd");
      }
      return quantity.mul(priceUsd).neg().sub(feesUsd);
    }
    case "SELL": {
      if (!quantity || !priceUsd) {
        throw new Error("SELL requires quantity and priceUsd");
      }
      return quantity.mul(priceUsd).sub(feesUsd);
    }
    case "DEPOSIT": {
      if (!grossAmountUsd) {
        throw new Error("DEPOSIT requires grossAmountUsd");
      }
      return grossAmountUsd;
    }
    case "WITHDRAWAL": {
      if (!grossAmountUsd) {
        throw new Error("WITHDRAWAL requires grossAmountUsd");
      }
      return grossAmountUsd.neg();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ledger/cashEffect.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger/cashEffect.ts lib/ledger/cashEffect.test.ts
git commit -m "feat: cash-effect computation per PRD L7"
```

---

### Task 5: Average-cost position derivation (pure function)

**Files:**
- Create: `lib/ledger/positions.ts`
- Test: `lib/ledger/positions.test.ts`

**Interfaces:**
- Produces: `PositionState { quantity, costBasisUsd, realisedPlUsd }`, `EMPTY_POSITION`, `applyBuy(prior, quantity, priceUsd, feesUsd): PositionState`, `applySell(prior, quantity, priceUsd, feesUsd): PositionState`, `avgCostUsd(state): Decimal | null`. Task 6's `applyTransaction` consumes all of these.

- [ ] **Step 1: Write the failing test**

Create `lib/ledger/positions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { EMPTY_POSITION, applyBuy, applySell, avgCostUsd } from "./positions";

describe("average-cost position derivation", () => {
  it("blends cost across two buys at different prices", () => {
    let state = EMPTY_POSITION;
    state = applyBuy(state, new Decimal(100), new Decimal(10), new Decimal(0));
    state = applyBuy(state, new Decimal(100), new Decimal(20), new Decimal(0));

    expect(state.quantity.toFixed(2)).toBe("200.00");
    expect(state.costBasisUsd.toFixed(2)).toBe("3000.00");
    expect(avgCostUsd(state)!.toFixed(2)).toBe("15.00");
  });

  it("realises P&L against the blended average, not a first-in lot (discriminates from FIFO)", () => {
    let state = EMPTY_POSITION;
    state = applyBuy(state, new Decimal(100), new Decimal(10), new Decimal(0));
    state = applyBuy(state, new Decimal(100), new Decimal(20), new Decimal(0));
    state = applySell(state, new Decimal(50), new Decimal(25), new Decimal(0));

    // Average cost: realised = 50 * (25 - 15) = 500
    // FIFO would realise: 50 * (25 - 10) = 750 -- different number, proves this isn't FIFO
    expect(state.realisedPlUsd.toFixed(2)).toBe("500.00");
    expect(state.quantity.toFixed(2)).toBe("150.00");
  });

  it("throws when selling more than the current position", () => {
    let state = EMPTY_POSITION;
    state = applyBuy(state, new Decimal(10), new Decimal(100), new Decimal(0));
    expect(() =>
      applySell(state, new Decimal(20), new Decimal(100), new Decimal(0))
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ledger/positions.test.ts`
Expected: FAIL — `positions.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/ledger/positions.ts`:

```ts
import Decimal from "decimal.js";

export interface PositionState {
  quantity: Decimal;
  costBasisUsd: Decimal;
  realisedPlUsd: Decimal;
}

export const EMPTY_POSITION: PositionState = {
  quantity: new Decimal(0),
  costBasisUsd: new Decimal(0),
  realisedPlUsd: new Decimal(0),
};

export function applyBuy(
  prior: PositionState,
  quantity: Decimal,
  priceUsd: Decimal,
  feesUsd: Decimal
): PositionState {
  const addedCost = quantity.mul(priceUsd).add(feesUsd);
  return {
    quantity: prior.quantity.add(quantity),
    costBasisUsd: prior.costBasisUsd.add(addedCost),
    realisedPlUsd: prior.realisedPlUsd,
  };
}

export function applySell(
  prior: PositionState,
  quantity: Decimal,
  priceUsd: Decimal,
  feesUsd: Decimal
): PositionState {
  if (quantity.gt(prior.quantity)) {
    throw new Error("Cannot sell more than current position quantity");
  }
  const avgCost = prior.quantity.eq(0)
    ? new Decimal(0)
    : prior.costBasisUsd.div(prior.quantity);
  const costRemoved = quantity.mul(avgCost);
  const proceeds = quantity.mul(priceUsd).sub(feesUsd);
  const realised = proceeds.sub(costRemoved);
  return {
    quantity: prior.quantity.sub(quantity),
    costBasisUsd: prior.costBasisUsd.sub(costRemoved),
    realisedPlUsd: prior.realisedPlUsd.add(realised),
  };
}

export function avgCostUsd(state: PositionState): Decimal | null {
  if (state.quantity.eq(0)) return null;
  return state.costBasisUsd.div(state.quantity);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ledger/positions.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger/positions.ts lib/ledger/positions.test.ts
git commit -m "feat: average-cost position derivation per TDD §4.6"
```

---

### Task 6: DB access layer — accounts, assets, applyTransaction orchestration

**Files:**
- Create: `lib/accounts.ts`, `lib/assets.ts`, `lib/ledger/applyTransaction.ts`
- Test: `lib/ledger/applyTransaction.test.ts` (integration, runs against the local Postgres from Task 2/3)
- Create (test infra): `vitest.config.ts`, `vitest.setup.ts`

**Interfaces:**
- Consumes: `getPool` (Task 2), `computeCashEffectUsd`/`SupportedTxnType` (Task 4), `EMPTY_POSITION`/`applyBuy`/`applySell`/`avgCostUsd`/`PositionState` (Task 5).
- Produces: `createAccount(name, custodian): Promise<Account>`, `listAccounts(): Promise<Account[]>`, `resolveOrCreateAsset(ticker, assetClass, name): Promise<Asset>`, `applyTransaction(input: NewTransactionInput): Promise<{transactionId: number}>`. Task 8 consumes the `AssetClass` type; Task 10 consumes all four functions directly.

- [ ] **Step 1: Configure Vitest to load `.env.local` and resolve the `@/` alias**

Create `vitest.setup.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.local" });
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 2: Write `lib/accounts.ts`**

```ts
import { getPool } from "./db";

export interface Account {
  id: number;
  name: string;
  custodian: string | null;
}

export async function createAccount(name: string, custodian: string | null): Promise<Account> {
  const pool = getPool();
  const result = await pool.query<Account>(
    `INSERT INTO accounts (name, custodian) VALUES ($1, $2) RETURNING id, name, custodian`,
    [name, custodian]
  );
  return result.rows[0];
}

export async function listAccounts(): Promise<Account[]> {
  const pool = getPool();
  const result = await pool.query<Account>(
    `SELECT id, name, custodian FROM accounts WHERE is_active = TRUE ORDER BY name`
  );
  return result.rows;
}
```

- [ ] **Step 3: Write `lib/assets.ts`**

```ts
import { getPool } from "./db";

export type AssetClass = "equity" | "etf" | "crypto";

export interface Asset {
  id: number;
  assetClass: AssetClass;
  primarySymbol: string;
  name: string;
}

// attributeTable is chosen from a fixed 3-value hardcoded set below, never
// from external input, so string interpolation here is not a SQL-injection risk.
export async function resolveOrCreateAsset(
  ticker: string,
  assetClass: AssetClass,
  name: string
): Promise<Asset> {
  const pool = getPool();
  const symbol = ticker.toUpperCase();

  const existing = await pool.query<{
    id: number; asset_class: AssetClass; primary_symbol: string; name: string;
  }>(
    `SELECT id, asset_class, primary_symbol, name FROM assets WHERE primary_symbol = $1`,
    [symbol]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return { id: row.id, assetClass: row.asset_class, primarySymbol: row.primary_symbol, name: row.name };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO assets (asset_class, primary_symbol, name) VALUES ($1, $2, $3) RETURNING id`,
      [assetClass, symbol, name]
    );
    const assetId = inserted.rows[0].id;

    const attributeTable: Record<AssetClass, string> = {
      equity: "asset_attributes_equity",
      etf: "asset_attributes_etf",
      crypto: "asset_attributes_crypto",
    };
    await client.query(`INSERT INTO ${attributeTable[assetClass]} (asset_id) VALUES ($1)`, [assetId]);

    await client.query("COMMIT");
    return { id: assetId, assetClass, primarySymbol: symbol, name };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Write `lib/ledger/applyTransaction.ts`**

```ts
import Decimal from "decimal.js";
import { getPool } from "../db";
import { computeCashEffectUsd, SupportedTxnType } from "./cashEffect";
import { EMPTY_POSITION, applyBuy, applySell, avgCostUsd, PositionState } from "./positions";

export interface NewTransactionInput {
  accountId: number;
  assetId: number | null;
  txnType: SupportedTxnType;
  tradeDate: string; // ISO date, e.g. "2026-01-15"
  quantity: Decimal | null;
  priceUsd: Decimal | null;
  feesUsd: Decimal;
  grossAmountUsd: Decimal | null;
  note: string | null;
}

export async function applyTransaction(input: NewTransactionInput): Promise<{ transactionId: number }> {
  const cashEffectUsd = computeCashEffectUsd({
    txnType: input.txnType,
    quantity: input.quantity,
    priceUsd: input.priceUsd,
    feesUsd: input.feesUsd,
    grossAmountUsd: input.grossAmountUsd,
  });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const grossAmount =
      input.quantity && input.priceUsd
        ? input.quantity.mul(input.priceUsd)
        : input.grossAmountUsd;

    const txnResult = await client.query<{ id: number }>(
      `INSERT INTO transactions
         (account_id, asset_id, txn_type, trade_date, quantity, price_usd,
          gross_amount_usd, fees_usd, cash_effect_usd, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        input.accountId,
        input.assetId,
        input.txnType,
        input.tradeDate,
        input.quantity ? input.quantity.toFixed(10) : null,
        input.priceUsd ? input.priceUsd.toFixed(10) : null,
        grossAmount ? grossAmount.toFixed(10) : null,
        input.feesUsd.toFixed(10),
        cashEffectUsd.toFixed(10),
        input.note,
      ]
    );
    const transactionId = txnResult.rows[0].id;

    // Recompute account cash from the full ledger — correct and simple at this data volume.
    const cashRow = await client.query<{ total: string | null }>(
      `SELECT SUM(cash_effect_usd) AS total FROM transactions WHERE account_id = $1`,
      [input.accountId]
    );
    const cashTotal = new Decimal(cashRow.rows[0].total ?? "0");
    await client.query(
      `INSERT INTO account_cash (account_id, cash_usd, computed_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_id) DO UPDATE SET cash_usd = EXCLUDED.cash_usd, computed_at = now()`,
      [input.accountId, cashTotal.toFixed(10)]
    );

    // Recompute positions_current for this (account, asset) if this txn touches a position.
    if (input.assetId && (input.txnType === "BUY" || input.txnType === "SELL")) {
      const priorRow = await client.query<{
        quantity: string; cost_basis_usd: string; realised_pl_usd: string; first_acquired: string | null;
      }>(
        `SELECT quantity, cost_basis_usd, realised_pl_usd, first_acquired FROM positions_current
         WHERE account_id = $1 AND asset_id = $2`,
        [input.accountId, input.assetId]
      );
      const hasPrior = priorRow.rows.length > 0;
      const prior: PositionState = hasPrior
        ? {
            quantity: new Decimal(priorRow.rows[0].quantity),
            costBasisUsd: new Decimal(priorRow.rows[0].cost_basis_usd),
            realisedPlUsd: new Decimal(priorRow.rows[0].realised_pl_usd),
          }
        : EMPTY_POSITION;
      const firstAcquired = hasPrior ? priorRow.rows[0].first_acquired : input.tradeDate;

      const next =
        input.txnType === "BUY"
          ? applyBuy(prior, input.quantity!, input.priceUsd!, input.feesUsd)
          : applySell(prior, input.quantity!, input.priceUsd!, input.feesUsd);

      const avg = avgCostUsd(next);

      await client.query(
        `INSERT INTO positions_current
           (account_id, asset_id, quantity, cost_basis_usd, avg_cost_usd, realised_pl_usd, first_acquired, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (account_id, asset_id) DO UPDATE SET
           quantity = EXCLUDED.quantity,
           cost_basis_usd = EXCLUDED.cost_basis_usd,
           avg_cost_usd = EXCLUDED.avg_cost_usd,
           realised_pl_usd = EXCLUDED.realised_pl_usd,
           computed_at = now()`,
        [
          input.accountId,
          input.assetId,
          next.quantity.toFixed(10),
          next.costBasisUsd.toFixed(10),
          avg ? avg.toFixed(10) : null,
          next.realisedPlUsd.toFixed(10),
          firstAcquired,
        ]
      );
    }

    await client.query("COMMIT");
    return { transactionId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: Write the failing integration test**

Create `lib/ledger/applyTransaction.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "../db";
import { createAccount } from "../accounts";
import { resolveOrCreateAsset } from "../assets";
import { applyTransaction } from "./applyTransaction";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("applyTransaction integration", () => {
  it("derives cash and position correctly across deposit + two buys + a sell", async () => {
    const account = await createAccount("Test Brokerage", "IBKR");
    const asset = await resolveOrCreateAsset("AAPL", "equity", "Apple Inc.");

    await applyTransaction({
      accountId: account.id, assetId: null, txnType: "DEPOSIT",
      tradeDate: "2026-01-01", quantity: null, priceUsd: null,
      feesUsd: new Decimal(0), grossAmountUsd: new Decimal(10000), note: null,
    });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-02", quantity: new Decimal(10), priceUsd: new Decimal(100),
      feesUsd: new Decimal(1), grossAmountUsd: null, note: null,
    });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-03", quantity: new Decimal(10), priceUsd: new Decimal(120),
      feesUsd: new Decimal(1), grossAmountUsd: null, note: null,
    });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "SELL",
      tradeDate: "2026-01-04", quantity: new Decimal(5), priceUsd: new Decimal(130),
      feesUsd: new Decimal(1), grossAmountUsd: null, note: null,
    });

    const pool = getPool();
    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [account.id]);
    const posRow = await pool.query(
      `SELECT quantity, cost_basis_usd, avg_cost_usd, realised_pl_usd FROM positions_current WHERE account_id = $1 AND asset_id = $2`,
      [account.id, asset.id]
    );

    // Cash: 10000 (deposit) - 1001 (buy1) - 1201 (buy2) + 649 (sell) = 8447
    expect(new Decimal(cashRow.rows[0].cash_usd).toFixed(2)).toBe("8447.00");

    // 20 bought at blended avg (1001+1201)/20 = 110.10, sell 5 -> qty 15, avg unchanged
    expect(new Decimal(posRow.rows[0].quantity).toFixed(2)).toBe("15.00");
    expect(new Decimal(posRow.rows[0].avg_cost_usd).toFixed(4)).toBe("110.1000");
  });

  it("rejects UPDATE and DELETE on transactions (append-only, AC-L5)", async () => {
    const account = await createAccount("Trigger Test", null);
    const { transactionId } = await applyTransaction({
      accountId: account.id, assetId: null, txnType: "DEPOSIT",
      tradeDate: "2026-01-01", quantity: null, priceUsd: null,
      feesUsd: new Decimal(0), grossAmountUsd: new Decimal(100), note: null,
    });

    const pool = getPool();
    await expect(
      pool.query(`UPDATE transactions SET note = 'x' WHERE id = $1`, [transactionId])
    ).rejects.toThrow();
    await expect(
      pool.query(`DELETE FROM transactions WHERE id = $1`, [transactionId])
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run lib/ledger/applyTransaction.test.ts`
Expected: FAIL — `applyTransaction.ts`/`accounts.ts`/`assets.ts` did not exist before Steps 2–4. (If you followed the steps in order, this will actually already pass — run it anyway to confirm both tests are exercised and pass for the *right* reason, then proceed.)

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run lib/ledger/applyTransaction.test.ts`
Expected: PASS, 2 tests. Requires Docker Postgres running (Task 2) and the migration applied (Task 3).

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts vitest.setup.ts lib/accounts.ts lib/assets.ts lib/ledger/applyTransaction.ts lib/ledger/applyTransaction.test.ts
git commit -m "feat: accounts/assets data layer + transaction orchestration with integration tests"
```

---

### Task 7: Bounded free market-data spike (Yahoo-compatible source)

**Purpose:** before committing to a Yahoo-based `MarketDataProvider` adapter (Task 8), verify a free Yahoo-compatible Node/TypeScript source actually covers what this slice needs. **Bounded strictly to price and corporate-action data — not fundamentals, analyst ratings, ETF holdings, or news.** This produces a written go/no-go decision that Task 8 depends on.

**Files:**
- Create: `scripts/spike-yahoo.ts` (throwaway research script, not imported by the application)
- Create: `docs/superpowers/plans/2026-08-25-yahoo-spike-results.md` (the recorded comparison — filled in when this task actually runs)

**Interfaces:**
- Consumes: nothing from earlier tasks — this is a standalone research spike.
- Produces: a go/no-go decision consumed by Task 8 (which provider is the default).

- [ ] **Step 1: Install the library**

```bash
npm install yahoo-finance2
```
Expected: `package.json`/`package-lock.json` updated with `yahoo-finance2`, no install errors.

- [ ] **Step 2: Write the bounded spike script**

Create `scripts/spike-yahoo.ts` — this covers exactly nine things and nothing more: US equity prices, ETF prices, multi-year history, adjusted/raw behaviour, BTC/ETH crypto, dividends, splits, missing symbols, and stale/failure/rate-limit behaviour.

```ts
import { config } from "dotenv";
config({ path: ".env.local" });
import yahooFinance from "yahoo-finance2";

const lines: string[] = [];
function log(line: string) {
  console.log(line);
  lines.push(line);
}

async function testEquityHistoryAndAdjustment() {
  log("\n=== 1. US equity multi-year history + adjusted/raw behaviour (AAPL) ===");
  const result = await yahooFinance.chart("AAPL", {
    period1: "2019-01-01",
    period2: "2020-12-31",
    interval: "1d",
    events: "div,splits",
  });
  log(`rows: ${result.quotes.length}`);
  log(`first: ${JSON.stringify(result.quotes[0])}`);
  log(`last: ${JSON.stringify(result.quotes[result.quotes.length - 1])}`);
  log(`adjclose field present: ${result.quotes[0].adjclose !== undefined}`);
}

async function testSplitDetection() {
  log("\n=== 2. Splits — AAPL 2020-08-31 4:1 (compare with EODHD-confirmed split from M0) ===");
  const result = await yahooFinance.chart("AAPL", {
    period1: "2020-07-01",
    period2: "2020-09-15",
    interval: "1d",
    events: "div,splits",
  });
  log(`events: ${JSON.stringify(result.events)}`);
}

async function testDividends() {
  log("\n=== 3. Dividends — AAPL 2024 ===");
  const result = await yahooFinance.chart("AAPL", {
    period1: "2024-01-01",
    period2: "2025-01-01",
    interval: "1d",
    events: "div",
  });
  log(`dividend events: ${JSON.stringify(result.events?.dividends)}`);
}

async function testEtf() {
  log("\n=== 4. ETF prices (QQQ) ===");
  const result = await yahooFinance.chart("QQQ", {
    period1: "2026-08-01",
    period2: "2026-08-25",
    interval: "1d",
  });
  log(`rows: ${result.quotes.length}, last close: ${result.quotes[result.quotes.length - 1]?.close}`);
}

async function testCrypto() {
  log("\n=== 5. Crypto (BTC-USD, ETH-USD) ===");
  for (const symbol of ["BTC-USD", "ETH-USD"]) {
    const result = await yahooFinance.chart(symbol, {
      period1: "2026-08-01",
      period2: "2026-08-25",
      interval: "1d",
    });
    log(`${symbol}: rows=${result.quotes.length}, last close=${result.quotes[result.quotes.length - 1]?.close}`);
  }
}

async function testMissingSymbol() {
  log("\n=== 6. Missing/invalid symbol behaviour ===");
  try {
    await yahooFinance.chart("ZZZZZZ-NOT-A-REAL-TICKER", { period1: "2026-08-01", period2: "2026-08-25" });
    log("no error thrown — unexpected, note this in the results log");
  } catch (err) {
    log(`threw as expected: ${err instanceof Error ? err.message : err}`);
  }
}

async function testRateLimitBehaviour() {
  log("\n=== 7. Rapid-fire request behaviour (rough stale/failure/rate-limit probe) ===");
  const start = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      yahooFinance.chart("AAPL", { period1: "2026-08-20", period2: "2026-08-25" })
    )
  );
  const failures = results.filter((r) => r.status === "rejected");
  log(`10 requests in ${Date.now() - start}ms, ${failures.length} failed`);
  if (failures.length > 0) {
    log(`sample failure: ${(failures[0] as PromiseRejectedResult).reason}`);
  }
}

async function main() {
  await testEquityHistoryAndAdjustment();
  await testSplitDetection();
  await testDividends();
  await testEtf();
  await testCrypto();
  await testMissingSymbol();
  await testRateLimitBehaviour();
  log("\n\n=== Paste everything above into docs/superpowers/plans/2026-08-25-yahoo-spike-results.md ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Explicitly **not** tested here, per the bounded scope: fundamentals, analyst ratings/recommendations, ETF holdings composition, news/press-release content. `yahoo-finance2` exposes modules for some of these — do not call them in this spike.

- [ ] **Step 3: Run the spike and record results**

```bash
npx tsx scripts/spike-yahoo.ts
```
Copy the full console output into a new file, `docs/superpowers/plans/2026-08-25-yahoo-spike-results.md`, under a heading for each of the 7 test functions.

- [ ] **Step 4: Compare against the EODHD data already validated in M0**

In the same results file, add a short comparison section against the EODHD findings already on record from M0: does the AAPL split show 2020-08-31 with a 4:1 ratio (matching EODHD's confirmed split)? Do dividend dates/amounts look consistent with EODHD's dividend rows? Is BTC/ETH data present and reasonably current?

- [ ] **Step 5: Apply the go/no-go decision**

Write one of these two verdicts at the top of the results file, with reasoning:

- **GO** — equity/ETF/crypto history returns real data with `adjclose` present; the AAPL split appears in `events.splits` for 2020-08-31 with a ratio matching EODHD's; dividends return realistic, comparable data; the missing-symbol test throws a catchable error (not silently wrong data); the rate-limit probe shows no severe failure rate (a few transient failures out of 10 is fine; most/all failing is not). → **Task 8 defaults `MARKET_DATA_PROVIDER` to `YAHOO`.**
- **NO-GO** — any hard blocker: the library throws on legitimate real tickers, split/dividend events aren't exposed at all, or the rate-limit probe fails severely. → **Task 8 defaults `MARKET_DATA_PROVIDER` to `EODHD`** instead; the `YahooProvider` adapter is still built (for future retry) but isn't the active default.

Either outcome is a valid, complete result for this task — the point is having evidence on record, not a predetermined answer.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/spike-yahoo.ts docs/superpowers/plans/2026-08-25-yahoo-spike-results.md
git commit -m "spike: bounded Yahoo-compatible market-data evaluation vs EODHD"
```

---

### Task 8: `MarketDataProvider` abstraction — Yahoo primary, EODHD fallback

**Files:**
- Create: `lib/marketdata/provider.ts`, `lib/marketdata/yahooProvider.ts`, `lib/marketdata/eodhdProvider.ts`, `lib/marketdata/index.ts`
- Test: `lib/marketdata/eodhdProvider.test.ts`, `lib/marketdata/index.test.ts` (pure-function unit tests only — no live network call in the automated suite)

**Interfaces:**
- Consumes: `getPool` (Task 2), `AssetClass` (Task 6), Task 7's go/no-go decision (which provider `index.ts` defaults to), `EODHD_API_KEY` from `process.env`.
- Produces: `MarketDataProvider` interface, `yahooProvider`, `eodhdProvider`, `EodhdQuotaExceededError`, `isPriceCacheFresh(retrievedAt, now?): boolean`, `upsertLatestPrice(assetId, ticker, assetClass): Promise<{fromCache: boolean; provider: string}>`. Task 10's dashboard actions consume `upsertLatestPrice` only — no provider-specific symbol mapping leaks into the UI layer.
- Free-tier protection, provider-agnostic: `upsertLatestPrice` checks `prices_daily` for a row already retrieved within the freshness window, keyed by whichever provider is active, before calling any provider at all. It only ever fetches an asset actually being transacted, and never fetches the same asset twice within the window. `eodhdProvider` throws `EodhdQuotaExceededError` on HTTP 402/429 with no retry loop; `yahooProvider` propagates its own failures the same way — no retry loop anywhere in this module.
- Corporate-action safety: this module writes **only** to `prices_daily` (`close`/`adj_close`). It never writes to `corporate_actions` or `transactions` — a raw split/dividend field from either provider cannot silently reach the ledger through this code path. Applying a corporate action to the ledger remains a separate, explicit, human-reviewed step that this slice doesn't build (Global Constraints; PRD MD4/MD5).

- [ ] **Step 1: Write the provider interface**

Create `lib/marketdata/provider.ts`:

```ts
import type { AssetClass } from "../assets";

export interface EodPricePoint {
  date: string; // YYYY-MM-DD
  close: number;
  adjustedClose: number;
}

export interface MarketDataProvider {
  readonly sourceName: string; // must match a row in the `sources` table
  fetchLatestEod(ticker: string, assetClass: AssetClass): Promise<EodPricePoint>;
}
```

- [ ] **Step 2: Write the failing unit test for the EODHD adapter's symbol mapping**

Create `lib/marketdata/eodhdProvider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toEodhdSymbol } from "./eodhdProvider";

describe("toEodhdSymbol", () => {
  it("maps equity tickers to the .US suffix", () => {
    expect(toEodhdSymbol("aapl", "equity")).toBe("AAPL.US");
  });
  it("maps ETF tickers to the .US suffix", () => {
    expect(toEodhdSymbol("qqq", "etf")).toBe("QQQ.US");
  });
  it("maps crypto tickers to the .CC suffix", () => {
    expect(toEodhdSymbol("btc-usd", "crypto")).toBe("BTC-USD.CC");
  });
});
```

Run: `npx vitest run lib/marketdata/eodhdProvider.test.ts`
Expected: FAIL — `eodhdProvider.ts` does not exist yet.

- [ ] **Step 3: Write the EODHD adapter (refactored from the earlier EODHD-only client into the shared interface)**

Create `lib/marketdata/eodhdProvider.ts`:

```ts
import type { MarketDataProvider, EodPricePoint } from "./provider";
import type { AssetClass } from "../assets";

export function toEodhdSymbol(ticker: string, assetClass: AssetClass): string {
  const symbol = ticker.toUpperCase();
  return assetClass === "crypto" ? `${symbol}.CC` : `${symbol}.US`;
}

export class EodhdQuotaExceededError extends Error {
  constructor(status: number) {
    super(
      `EODHD quota exhausted (HTTP ${status}). Not retrying automatically — ` +
        `wait for the free-tier daily reset or upgrade the plan before fetching more prices.`
    );
    this.name = "EodhdQuotaExceededError";
  }
}

export const eodhdProvider: MarketDataProvider = {
  sourceName: "EODHD",
  async fetchLatestEod(ticker: string, assetClass: AssetClass): Promise<EodPricePoint> {
    const apiKey = process.env.EODHD_API_KEY;
    if (!apiKey) {
      throw new Error("EODHD_API_KEY is not set — check .env.local");
    }
    const symbol = toEodhdSymbol(ticker, assetClass);
    const url = `https://eodhd.com/api/eod/${symbol}?api_token=${apiKey}&fmt=json&period=d&order=d&limit=1`;
    const res = await fetch(url);
    if (res.status === 402 || res.status === 429) {
      // Quota/rate-limit exhaustion — fail clearly and immediately. No retry
      // loop: retrying a quota error just burns more of tomorrow's allowance.
      throw new EodhdQuotaExceededError(res.status);
    }
    if (!res.ok) {
      throw new Error(`EODHD request failed: ${res.status}`);
    }
    const rows = (await res.json()) as { date: string; close: number; adjusted_close: number }[];
    if (!rows.length) {
      throw new Error(`No EOD data returned for ${symbol}`);
    }
    return { date: rows[0].date, close: rows[0].close, adjustedClose: rows[0].adjusted_close };
  },
};
```

- [ ] **Step 4: Run the EODHD adapter test**

Run: `npx vitest run lib/marketdata/eodhdProvider.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the Yahoo adapter**

Create `lib/marketdata/yahooProvider.ts`. Symbol handling and response shape here should match whatever Task 7's spike actually confirmed — if the live API differs from what's drafted below, correct this file to match the spike's findings before moving on:

```ts
import yahooFinance from "yahoo-finance2";
import type { MarketDataProvider, EodPricePoint } from "./provider";

export const yahooProvider: MarketDataProvider = {
  sourceName: "YAHOO",
  async fetchLatestEod(ticker: string): Promise<EodPricePoint> {
    // Yahoo's own symbol conventions already match plain US tickers and
    // "BTC-USD"-style crypto pairs — confirmed in the Task 7 spike, so no
    // per-asset-class suffix mapping is needed here (unlike EODHD).
    const symbol = ticker.toUpperCase();
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = await yahooFinance.chart(symbol, {
      period1: weekAgo.toISOString().slice(0, 10),
      period2: today.toISOString().slice(0, 10),
      interval: "1d",
    });
    const quotes = result.quotes.filter((q) => q.close != null);
    if (!quotes.length) {
      throw new Error(`No EOD data returned for ${symbol} from Yahoo`);
    }
    const latest = quotes[quotes.length - 1];
    return {
      date: new Date(latest.date).toISOString().slice(0, 10),
      close: latest.close!,
      adjustedClose: latest.adjclose ?? latest.close!,
    };
  },
};
```

- [ ] **Step 6: Write the failing unit test for the cache-freshness check**

Create `lib/marketdata/index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPriceCacheFresh } from "./index";

describe("isPriceCacheFresh", () => {
  it("is fresh within the 12-hour window", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const retrievedAt = new Date("2026-01-01T06:00:00Z");
    expect(isPriceCacheFresh(retrievedAt, now)).toBe(true);
  });

  it("is stale after the 12-hour window", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    const retrievedAt = new Date("2026-01-01T06:00:00Z");
    expect(isPriceCacheFresh(retrievedAt, now)).toBe(false);
  });
});
```

Run: `npx vitest run lib/marketdata/index.test.ts`
Expected: FAIL — `index.ts` does not exist yet.

- [ ] **Step 7: Write the provider-agnostic selection + cache logic**

Create `lib/marketdata/index.ts`. Set `MARKET_DATA_PROVIDER` per Task 7's go/no-go decision — this example defaults to `YAHOO`; flip the default (or override via `.env.local`) if Task 7 returned NO-GO:

```ts
import Decimal from "decimal.js";
import { getPool } from "../db";
import { yahooProvider } from "./yahooProvider";
import { eodhdProvider } from "./eodhdProvider";
import type { MarketDataProvider } from "./provider";
import type { AssetClass } from "../assets";

const providers: Record<string, MarketDataProvider> = {
  YAHOO: yahooProvider,
  EODHD: eodhdProvider,
};

// Default provider for this slice, per Task 7's spike result. Swap via
// MARKET_DATA_PROVIDER=EODHD in .env.local — no code change needed to fall back.
function activeProvider(): MarketDataProvider {
  const name = (process.env.MARKET_DATA_PROVIDER ?? "YAHOO").toUpperCase();
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Unknown MARKET_DATA_PROVIDER '${name}' — expected one of: ${Object.keys(providers).join(", ")}`
    );
  }
  return provider;
}

const CACHE_FRESHNESS_HOURS = 12;

export function isPriceCacheFresh(retrievedAt: Date, now: Date = new Date()): boolean {
  const ageHours = (now.getTime() - retrievedAt.getTime()) / (1000 * 60 * 60);
  return ageHours < CACHE_FRESHNESS_HOURS;
}

export async function upsertLatestPrice(
  assetId: number,
  ticker: string,
  assetClass: AssetClass
): Promise<{ fromCache: boolean; provider: string }> {
  const provider = activeProvider();
  const pool = getPool();

  const sourceResult = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = $1`, [
    provider.sourceName,
  ]);
  if (sourceResult.rows.length === 0) {
    throw new Error(
      `${provider.sourceName} source row missing — was migrations/001_portfolio_core.sql applied?`
    );
  }
  const sourceId = sourceResult.rows[0].id;

  // Reuse a recent stored price instead of calling the provider again — this
  // is the free-tier protection: fetch only assets actually being
  // transacted, and only once per freshness window, regardless of provider.
  const cached = await pool.query<{ retrieved_at: string }>(
    `SELECT retrieved_at FROM prices_daily
     WHERE asset_id = $1 AND source_id = $2
     ORDER BY price_date DESC LIMIT 1`,
    [assetId, sourceId]
  );
  if (cached.rows.length > 0 && isPriceCacheFresh(new Date(cached.rows[0].retrieved_at))) {
    return { fromCache: true, provider: provider.sourceName };
  }

  const point = await provider.fetchLatestEod(ticker, assetClass);
  await pool.query(
    `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (asset_id, price_date, source_id) DO UPDATE SET
       close = EXCLUDED.close, adj_close = EXCLUDED.adj_close, retrieved_at = now()`,
    [
      assetId,
      point.date,
      new Decimal(point.close).toFixed(10),
      new Decimal(point.adjustedClose).toFixed(10),
      sourceId,
    ]
  );
  return { fromCache: false, provider: provider.sourceName };
}
```

Note: `AssetClass` remains `lib/assets.ts`'s canonical definition — imported here, not redefined. No caching service (Redis or otherwise) is introduced — the cache is just the `prices_daily` table this slice already writes to, read before deciding whether to call any provider at all. No paid subscription is required for this task to work: with a Task 7 GO decision, `YAHOO` is free and requires no API key at all.

- [ ] **Step 8: Run the cache-freshness test**

Run: `npx vitest run lib/marketdata/index.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 9: Manually verify `upsertLatestPrice` against the live active provider once**

Manual smoke check, not part of the automated suite (keeps `npm run test` free of network dependency and quota consumption):
```bash
npx tsx -e "
import { config } from 'dotenv'; config({ path: '.env.local' });
import { getPool } from './lib/db';
import { resolveOrCreateAsset } from './lib/assets';
import { upsertLatestPrice } from './lib/marketdata/index';

(async () => {
  const asset = await resolveOrCreateAsset('AAPL', 'equity', 'Apple Inc.');
  const first = await upsertLatestPrice(asset.id, 'AAPL', 'equity');
  const second = await upsertLatestPrice(asset.id, 'AAPL', 'equity');
  console.log('first call:', first, '(expect fromCache: false)');
  console.log('second call:', second, '(expect fromCache: true — same asset, within freshness window)');
  const pool = getPool();
  const row = await pool.query('SELECT * FROM prices_daily WHERE asset_id = \$1', [asset.id]);
  console.log(row.rows);
  await pool.end();
})();
"
```
Expected: `first.fromCache: false`, `second.fromCache: true`, both showing `provider` matching Task 7's decision, and exactly one row in `prices_daily` for this asset with a real recent `close`/`adj_close`.

- [ ] **Step 10: Commit**

```bash
git add lib/marketdata/provider.ts lib/marketdata/yahooProvider.ts lib/marketdata/eodhdProvider.ts lib/marketdata/eodhdProvider.test.ts lib/marketdata/index.ts lib/marketdata/index.test.ts
git commit -m "feat: MarketDataProvider abstraction — Yahoo default, EODHD fallback"
```

---

### Task 9: Portfolio view aggregation

**Files:**
- Create: `lib/portfolio.ts`
- Test: `lib/portfolio.test.ts` (integration, against local Postgres)

**Interfaces:**
- Consumes: `getPool` (Task 2). Reads `positions_current`, `accounts`, `assets`, `prices_daily`, `account_cash` (all from Task 3's migration).
- Produces: `getPortfolioView(): Promise<PortfolioView>`, `PortfolioView`, `PositionView`. Task 10's dashboard page consumes this directly.

- [ ] **Step 1: Write the failing integration test**

Create `lib/portfolio.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "./db";
import { createAccount } from "./accounts";
import { resolveOrCreateAsset } from "./assets";
import { applyTransaction } from "./ledger/applyTransaction";
import { getPortfolioView } from "./portfolio";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("getPortfolioView", () => {
  it("combines positions, latest price, and cash into totals", async () => {
    const account = await createAccount("Test Brokerage", "IBKR");
    const asset = await resolveOrCreateAsset("AAPL", "equity", "Apple Inc.");

    await applyTransaction({
      accountId: account.id, assetId: null, txnType: "DEPOSIT",
      tradeDate: "2026-01-01", quantity: null, priceUsd: null,
      feesUsd: new Decimal(0), grossAmountUsd: new Decimal(10000), note: null,
    });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-02", quantity: new Decimal(10), priceUsd: new Decimal(100),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });

    const pool = getPool();
    const sourceRow = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'EODHD'`);
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, '2026-01-03', 120.00, 120.00, $2, now())`,
      [asset.id, sourceRow.rows[0].id]
    );

    const view = await getPortfolioView();

    expect(view.positions).toHaveLength(1);
    expect(view.positions[0].symbol).toBe("AAPL");
    expect(view.positions[0].marketValueUsd!.toFixed(2)).toBe("1200.00");
    expect(view.positions[0].unrealisedPlUsd!.toFixed(2)).toBe("200.00"); // 1200 - 1000 cost basis
    expect(view.totalCashUsd.toFixed(2)).toBe("9000.00"); // 10000 - 1000
    expect(view.totalMarketValueUsd.toFixed(2)).toBe("1200.00");
    expect(view.totalPortfolioValueUsd.toFixed(2)).toBe("10200.00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portfolio.test.ts`
Expected: FAIL — `portfolio.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/portfolio.ts`:

```ts
import Decimal from "decimal.js";
import { getPool } from "./db";

export interface PositionView {
  accountId: number;
  accountName: string;
  assetId: number;
  symbol: string;
  assetName: string;
  quantity: Decimal;
  avgCostUsd: Decimal | null;
  costBasisUsd: Decimal;
  latestPriceUsd: Decimal | null;
  priceDate: string | null;
  marketValueUsd: Decimal | null;
  unrealisedPlUsd: Decimal | null;
}

export interface PortfolioView {
  positions: PositionView[];
  totalCashUsd: Decimal;
  totalMarketValueUsd: Decimal;
  totalPortfolioValueUsd: Decimal;
}

export async function getPortfolioView(): Promise<PortfolioView> {
  const pool = getPool();

  const positionsResult = await pool.query(`
    SELECT
      pc.account_id, a.name AS account_name,
      pc.asset_id, ast.primary_symbol AS symbol, ast.name AS asset_name,
      pc.quantity, pc.avg_cost_usd, pc.cost_basis_usd,
      lp.close AS latest_price, lp.price_date
    FROM positions_current pc
    JOIN accounts a ON a.id = pc.account_id
    JOIN assets ast ON ast.id = pc.asset_id
    LEFT JOIN LATERAL (
      SELECT close, price_date FROM prices_daily
      WHERE asset_id = pc.asset_id
      ORDER BY price_date DESC LIMIT 1
    ) lp ON true
    WHERE pc.quantity <> 0
    ORDER BY ast.primary_symbol
  `);

  const positions: PositionView[] = positionsResult.rows.map((row) => {
    const quantity = new Decimal(row.quantity);
    const costBasisUsd = new Decimal(row.cost_basis_usd);
    const avgCostUsd = row.avg_cost_usd ? new Decimal(row.avg_cost_usd) : null;
    const latestPriceUsd = row.latest_price ? new Decimal(row.latest_price) : null;
    const marketValueUsd = latestPriceUsd ? quantity.mul(latestPriceUsd) : null;
    const unrealisedPlUsd = marketValueUsd ? marketValueUsd.sub(costBasisUsd) : null;

    return {
      accountId: row.account_id,
      accountName: row.account_name,
      assetId: row.asset_id,
      symbol: row.symbol,
      assetName: row.asset_name,
      quantity,
      avgCostUsd,
      costBasisUsd,
      latestPriceUsd,
      priceDate: row.price_date,
      marketValueUsd,
      unrealisedPlUsd,
    };
  });

  const cashResult = await pool.query(`SELECT COALESCE(SUM(cash_usd), 0) AS total FROM account_cash`);
  const totalCashUsd = new Decimal(cashResult.rows[0].total);

  const totalMarketValueUsd = positions.reduce(
    (sum, p) => (p.marketValueUsd ? sum.add(p.marketValueUsd) : sum),
    new Decimal(0)
  );

  return {
    positions,
    totalCashUsd,
    totalMarketValueUsd,
    totalPortfolioValueUsd: totalCashUsd.add(totalMarketValueUsd),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portfolio.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Run the full test suite before moving to UI**

Run: `npm run test`
Expected: all tests across Tasks 4–9 pass (cashEffect, positions, applyTransaction, eodhdProvider, marketdata index, portfolio).

- [ ] **Step 6: Commit**

```bash
git add lib/portfolio.ts lib/portfolio.test.ts
git commit -m "feat: portfolio view aggregation — positions + price + cash + totals"
```

---

### Task 10: Server Actions + dashboard page

**Files:**
- Create: `app/actions.ts`, `app/page.tsx`

**Interfaces:**
- Consumes: `createAccount`, `listAccounts` (Task 6), `resolveOrCreateAsset` (Task 6), `applyTransaction` (Task 6), `upsertLatestPrice` (Task 8). Note this layer no longer imports any provider-specific symbol mapping (`toEodhdSymbol` or otherwise) — that's fully internal to Task 8's adapters now.
- Produces: the browser-visible dashboard at `/`. This is the last task before real-data verification.

A note on scope: this uses Next.js Server Actions (`"use server"`) for the two writes instead of the formal `/api/*` REST routes described in TDD §10. That REST surface — with its specific enforcement rules (e.g. no `sort=pct_change`) — is a real M1/M2 requirement, just not one this slice needs yet; nothing here blocks adding it later.

- [ ] **Step 1: Write `app/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";
import { createAccount } from "@/lib/accounts";
import { resolveOrCreateAsset, type AssetClass } from "@/lib/assets";
import { applyTransaction } from "@/lib/ledger/applyTransaction";
import { upsertLatestPrice } from "@/lib/marketdata";

export async function createAccountAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const custodian = String(formData.get("custodian") ?? "").trim() || null;
  if (!name) throw new Error("Account name is required");
  await createAccount(name, custodian);
  revalidatePath("/");
}

export async function createTransactionAction(formData: FormData) {
  const accountId = Number(formData.get("accountId"));
  const txnType = String(formData.get("txnType")) as "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL";
  const tradeDate = String(formData.get("tradeDate"));
  const feesUsd = new Decimal(String(formData.get("feesUsd") || "0"));
  const note = String(formData.get("note") ?? "").trim() || null;

  if (txnType === "DEPOSIT" || txnType === "WITHDRAWAL") {
    const amount = new Decimal(String(formData.get("amount")));
    await applyTransaction({
      accountId, assetId: null, txnType, tradeDate,
      quantity: null, priceUsd: null, feesUsd, grossAmountUsd: amount, note,
    });
  } else {
    const ticker = String(formData.get("ticker")).toUpperCase().trim();
    const assetClass = String(formData.get("assetClass")) as AssetClass;
    const quantity = new Decimal(String(formData.get("quantity")));
    const priceUsd = new Decimal(String(formData.get("priceUsd")));

    const asset = await resolveOrCreateAsset(ticker, assetClass, ticker);
    await applyTransaction({
      accountId, assetId: asset.id, txnType, tradeDate,
      quantity, priceUsd, feesUsd, grossAmountUsd: null, note,
    });

    try {
      await upsertLatestPrice(asset.id, ticker, assetClass);
    } catch (err) {
      // Best-effort: the dashboard shows "no price yet" if this fails; the
      // transaction itself has already committed successfully above. Logged
      // (never retried) so a provider quota/failure error is visible rather than silent.
      console.error("Price fetch skipped:", err instanceof Error ? err.message : err);
    }
  }

  revalidatePath("/");
}
```

- [ ] **Step 2: Write `app/page.tsx`**

```tsx
import { listAccounts } from "@/lib/accounts";
import { getPortfolioView } from "@/lib/portfolio";
import { createAccountAction, createTransactionAction } from "./actions";

export default async function DashboardPage() {
  const accounts = await listAccounts();
  const portfolio = await getPortfolioView();

  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <h1>Calboard</h1>

      <section>
        <h2>Portfolio value</h2>
        <p style={{ fontSize: "1.5rem" }}>US${portfolio.totalPortfolioValueUsd.toFixed(2)}</p>
        <p>
          Cash: US${portfolio.totalCashUsd.toFixed(2)} &middot; Holdings: US$
          {portfolio.totalMarketValueUsd.toFixed(2)}
        </p>
      </section>

      <section>
        <h2>Holdings</h2>
        <table border={1} cellPadding={6}>
          <thead>
            <tr>
              <th>Symbol</th><th>Account</th><th>Qty</th><th>Avg cost</th>
              <th>Price</th><th>Price date</th><th>Market value</th><th>Unrealised P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.positions.map((p) => (
              <tr key={`${p.accountId}-${p.assetId}`}>
                <td>{p.symbol}</td>
                <td>{p.accountName}</td>
                <td>{p.quantity.toFixed(4)}</td>
                <td>{p.avgCostUsd ? p.avgCostUsd.toFixed(2) : "—"}</td>
                <td>{p.latestPriceUsd ? p.latestPriceUsd.toFixed(2) : "no price yet"}</td>
                <td>{p.priceDate ?? "—"}</td>
                <td>{p.marketValueUsd ? p.marketValueUsd.toFixed(2) : "—"}</td>
                <td>{p.unrealisedPlUsd ? p.unrealisedPlUsd.toFixed(2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Accounts</h2>
        <ul>
          {accounts.map((a) => (
            <li key={a.id}>{a.name}{a.custodian ? ` (${a.custodian})` : ""}</li>
          ))}
        </ul>
        <form action={createAccountAction}>
          <input name="name" placeholder="Account name" required />
          <input name="custodian" placeholder="Custodian (optional)" />
          <button type="submit">Add account</button>
        </form>
      </section>

      <section>
        <h2>Add transaction</h2>
        <form action={createTransactionAction}>
          <select name="accountId" required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <select name="txnType" required>
            <option value="DEPOSIT">Deposit</option>
            <option value="WITHDRAWAL">Withdrawal</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
          <input name="tradeDate" type="date" required />
          <input name="amount" placeholder="Amount (deposit/withdrawal)" />
          <input name="ticker" placeholder="Ticker (buy/sell)" />
          <select name="assetClass">
            <option value="equity">Equity</option>
            <option value="etf">ETF</option>
            <option value="crypto">Crypto</option>
          </select>
          <input name="quantity" placeholder="Quantity (buy/sell)" />
          <input name="priceUsd" placeholder="Price USD (buy/sell)" />
          <input name="feesUsd" placeholder="Fees USD" defaultValue="0" />
          <input name="note" placeholder="Note (optional)" />
          <button type="submit">Add transaction</button>
        </form>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Start the dev server and verify the empty state renders**

```bash
npm run dev
```
Open `http://localhost:3000` in a browser. Expected: page loads, shows "Portfolio value US$0.00", empty holdings table, empty accounts list, both forms visible.

- [ ] **Step 4: Manually exercise both forms**

In the browser: add an account (e.g. name "Test", custodian "Test"), then add a `DEPOSIT` transaction for $1000, then add a `BUY` for a real ticker (e.g. 1 share of `AAPL`, price `100`). Expected: page re-renders after each submit (Server Action + `revalidatePath`), the account appears in the Accounts list, and after the BUY the Holdings table shows one row with a real fetched price (not "no price yet") and a computed market value.

- [ ] **Step 5: Commit**

```bash
git add app/actions.ts app/page.tsx
git commit -m "feat: dashboard page + server actions for account/transaction entry"
```

---

### Task 11: Verify with a small portfolio, then enter your real holdings

**Files:** none created — this task is verification only.

This task has two phases. **Do not proceed to Phase B until every hand-calculated number in Phase A matches the dashboard exactly.** That checkpoint is what confirms the accounting is trustworthy before your full real portfolio goes into it.

#### Phase A — small representative portfolio, hand-checked

- [ ] **Step 1: Clear any test data**

```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "TRUNCATE transactions, positions_current, account_cash, prices_daily, assets, accounts RESTART IDENTITY CASCADE;"
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "SELECT name FROM sources;"
```
Expected: the second command still shows `EODHD` — truncating the ledger/reference tables above does not touch `sources`.

- [ ] **Step 2: Enter one account and a small representative set of holdings**

With `npm run dev` running, open `http://localhost:3000`:
1. Add one account (a real one is fine, or a clearly-named test account).
2. Add a `DEPOSIT` of a round number that's easy to hand-check, e.g. `10000`.
3. Add a `BUY` for one real equity you actually hold (real ticker, real quantity, real price).
4. If practical, add a `BUY` for one real crypto holding (e.g. ticker `BTC-USD`, asset class `crypto`) — this exercises the active provider's crypto handling from Task 8 against live data.

Keep this to 2–4 transactions total — the goal is a small, fully hand-checkable set, not your whole portfolio.

- [ ] **Step 3: Hand-calculate the expected numbers before looking at the dashboard**

On paper or a calculator, compute for each holding:
- Expected quantity — what you entered.
- Expected average cost — the price you entered (a single buy, so avg cost = buy price exactly).
- Expected cash — deposit amount minus Σ(quantity × price + fees) for every `BUY`.
- Expected market value per holding — quantity × the current price you can see on any finance site for that ticker (approximate — EODHD's EOD close may differ slightly from real-time; that's expected).
- Expected total portfolio value — expected cash + Σ expected market values.

- [ ] **Step 4: Compare against the dashboard**

Reload `http://localhost:3000`. For cash, quantity, and average cost, the dashboard figure must match your hand calculation **exactly** — these are exact arithmetic, not estimates. Market value will only match approximately, since it's driven by EODHD's actual close rather than your hand-estimate. **If cash, quantity, or average cost don't match exactly, stop and debug before Phase B** — do not proceed to entering your full portfolio on top of an unverified calculation.

- [ ] **Step 5: Confirm the price cache is working (Task 8's free-tier protection)**

Add a second `BUY` for the *same* equity ticker from Step 2 (any quantity/price). Then check that only one price row exists per asset, not one per transaction:
```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "SELECT asset_id, price_date, retrieved_at FROM prices_daily ORDER BY retrieved_at DESC;"
```
Expected: one row per distinct asset — confirms the second `BUY` reused the cached price instead of calling the active provider again.

#### Phase B — enter your full real portfolio

Only start this phase once every check in Phase A passed.

- [ ] **Step 6: Clear the Phase A data**

```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "TRUNCATE transactions, positions_current, account_cash, prices_daily, assets, accounts RESTART IDENTITY CASCADE;"
```

- [ ] **Step 7: Enter your real accounts and full real holdings**

Repeat Step 2's pattern for every real account and every real current holding: one `DEPOSIT` placeholder plus `BUY`s at your real average cost and quantity. This produces a correct *current* position and cost basis — it does not reconstruct historical transaction-by-transaction cash flow, which is out of scope for this slice.

- [ ] **Step 8: Confirm the append-only guarantee holds for real data too**

```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "UPDATE transactions SET note = 'test' WHERE id = 1;"
```
Expected: errors with the `transactions is append-only` message from Task 3's trigger.

- [ ] **Step 9: Confirm this is still localhost-only**

```bash
docker compose ps
```
Confirm the Postgres port mapping is bound to your machine only (default Docker Desktop behavior). Confirm `npm run dev` is the only thing serving the app — no `next start` bound to a public interface, no Render deploy. This slice stays local until authentication exists.

- [ ] **Step 10: Final commit**

```bash
git status
git add -A
git commit -m "docs: M1 vertical slice complete — real holdings render in browser"
```
Before this commit, review `git status` output and confirm no `.env.local` or other secret file is staged.

---

## Self-Review

**Spec coverage:** `sources`/`assets`/`accounts` reference tables — Task 3, seeded with both `EODHD` and `YAHOO` rows for Task 8's adapters. `prices_daily`/`corporate_actions` — Task 3 (schema) + Task 8 (prices populated by whichever provider is active; `corporate_actions` intentionally unused by this slice's code path — the market-data layer writes only to `prices_daily`, never to `corporate_actions` or `transactions`, so no provider's raw split/dividend fields can silently reach the ledger). Single-table `transactions` with `link_id`/`link_role` — Task 3 (schema); link columns unused by this slice's UI, consistent with scope. Append-only trigger — Task 3 (schema, verified against a *clean* database in Step 6 — exact object count re-checked against TDD §1.1: 19 tables, 1 view, 2 enum types, 1 trigger, enumerated in Task 3's Interfaces block) + Task 6/Task 11 (tested against real usage). Cash effect computation (PRD L7) — Task 4. Average cost per account (PRD L8) — Task 5. Derived cash (PRD L6) — Task 6. `positions_current`/`account_cash` — Task 6. Bounded market-data spike, strictly prices/splits/dividends, no fundamentals/ratings/ETF-holdings/news — Task 7, producing the go/no-go that Task 8 depends on. `MarketDataProvider` abstraction with a free Yahoo-compatible default and EODHD as a swappable fallback (no paid subscription required to start M1) — Task 8, with a `prices_daily`-backed freshness cache and a distinct `EodhdQuotaExceededError` protecting EODHD's quota specifically, generalized so any provider's quota/rate-limit failure fails clearly with no retry loop. Portfolio value display — Task 9/10. Git init + secret handling — Task 1/2. Docker preflight before any Docker-dependent step — Task 2 Step 1. Small hand-checked portfolio gating full portfolio entry — Task 11 Phase A/B. Localhost-only, no deployment — Global Constraints + Task 11 Step 9. All explicitly deferred items, including fundamentals/ratings/ETF-holdings/news from the spike, are listed in "Explicitly out of scope" above.

**Placeholder scan:** no TBD/TODO markers; every step has real, runnable code or an exact shell command with an expected output. Task 7's results-log file is the one file whose *content* is filled in at execution time rather than now — that's correct for a research spike recording live output, not a placeholder in the "TBD business logic" sense the skill warns against.

**Type consistency:** `AssetClass` is defined once, in `lib/assets.ts` (Task 6), and imported by `lib/marketdata/provider.ts`, `eodhdProvider.ts`, `index.ts` (Task 8) and `app/actions.ts` (Task 10) rather than redefined. `computeCashEffectUsd`/`SupportedTxnType` (Task 4), `applyBuy`/`applySell`/`avgCostUsd`/`EMPTY_POSITION`/`PositionState` (Task 5), `createAccount`/`listAccounts`/`Account` (Task 6), `resolveOrCreateAsset`/`Asset` (Task 6), `applyTransaction`/`NewTransactionInput` (Task 6), `MarketDataProvider`/`EodPricePoint` (Task 8, `provider.ts`), `toEodhdSymbol`/`EodhdQuotaExceededError`/`eodhdProvider` (Task 8, `eodhdProvider.ts`), `yahooProvider` (Task 8, `yahooProvider.ts`), `isPriceCacheFresh`/`upsertLatestPrice` (Task 8, `index.ts`), `getPortfolioView`/`PortfolioView`/`PositionView` (Task 9) are each defined once and consumed by name-identical imports in every later task that uses them. `upsertLatestPrice`'s signature changed from the old Task 7's `(assetId, eodhdSymbol) => Promise<{fromCache}>` to the new Task 8's `(assetId, ticker, assetClass) => Promise<{fromCache, provider}>` — this is a clean replacement, not a straddle, since Task 10 (the only caller) is written against the new signature only.
