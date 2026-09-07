-- 002_analyzer_runs.sql
-- Stock Analyzer v1 run persistence, per design R7 (ruled 6 September 2026)
-- and spec §2, §3.8.3, §3.8.4, §4.4, §6.3.
--
-- THE PORTFOLIO BOUNDARY (spec §1.4, ruled by Command Center 7 September 2026).
-- These tables share a database with the portfolio schema of 001. They share
-- nothing else. No foreign key in this file points at assets, positions,
-- transactions, prices_daily or any other 001 object, and none may be added
-- later. §1.4 is a boundary, not a preference, and a foreign key is how it
-- would quietly stop being one. The company under analysis is therefore held
-- as a plain `ticker` string, deliberately NOT as a reference to assets(id):
-- resolving it against the portfolio's asset table is the exact coupling §1.4
-- forbids. Every REFERENCES clause below is analyzer -> analyzer.
--
-- WHAT IS NOT STORED HERE. The fact set itself is not persisted. Facts come
-- from the fixtures (M7) and later from acquisition (M8); this schema stores
-- only the human decisions taken against them, keyed by FactRecord.id. That
-- keeps one fact contract (spec J4, §10.0) rather than a second copy that
-- could drift from it.

-- 1. analyzer_runs
--
-- One row per committed run. The run is created when the analyst confirms the
-- resolved company, NOT when the ticker is typed (design:121). A ticker that
-- fails identity resolution — UNKNOWN, UNSUPPORTED or UNAVAILABLE — never
-- reaches this table: per §9.3.1 UNSUPPORTED INSTRUMENT is refused at Step 1,
-- "before a run exists". There is deliberately no listing index and no route
-- that enumerates this table (R7).
CREATE TABLE analyzer_runs (
  -- UUIDv4, generated in application code. NEVER serial: runId travels in the
  -- URL and R7's property is "lose the URL and the run is gone". A sequential
  -- key would make every run reachable by typing /analyzer/1, which is a
  -- listing surface arriving without a listing endpoint.
  run_id                  UUID PRIMARY KEY,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Step 1 identity, frozen at the moment of confirmation.
  ticker                  TEXT NOT NULL,
  resolved_company_name   TEXT NOT NULL,
  -- Single-valued by design. Only a listed operating company may hold a run
  -- (§1.2, §2, §9.3.1); funds, indices and currency/crypto pairs are refused
  -- at resolution. The constraint means the database itself cannot hold a run
  -- for a refused instrument class, rather than trusting the route to check.
  instrument_class        TEXT NOT NULL
                            CHECK (instrument_class = 'LISTED OPERATING COMPANY'),
  identity_confirmed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Step 6 — profile confirmation (§6.3). All five columns are NULL until the
  -- analyst decides; none is pre-selected and there is no default.
  profile_decision        TEXT
                            CHECK (profile_decision IN
                              ('CONFIRMED', 'OVERRIDDEN', 'CANNOT JUDGE')),
  -- The profile the run proceeds on. Under CANNOT JUDGE this is the
  -- recommended profile, used provisionally (§6.3).
  profile                 TEXT,
  -- Free text, and free deliberately: §6.3 makes the override reason free text
  -- precisely because an override is a one-off judgment nobody will count.
  -- This is the opposite of the §3.8.4 fact reason codes below, which are
  -- coded because they ARE counted.
  profile_override_reason TEXT,
  profile_human_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  profile_decided_at      TIMESTAMPTZ,

  -- A decision is all-or-nothing: decision, profile and timestamp arrive
  -- together or not at all.
  CONSTRAINT profile_decision_is_complete CHECK (
    (profile_decision IS NULL
       AND profile IS NULL
       AND profile_decided_at IS NULL)
    OR
    (profile_decision IS NOT NULL
       AND profile IS NOT NULL
       AND profile_decided_at IS NOT NULL)
  ),

  -- An override carries its reason; the other two outcomes carry none.
  -- §6.3: "Cannot judge records no reason — requiring an explanation from an
  -- analyst who has just said they cannot assess the question produces text
  -- nobody can act on."
  CONSTRAINT profile_override_reason_matches_decision CHECK (
    (profile_decision = 'OVERRIDDEN' AND profile_override_reason IS NOT NULL)
    OR
    (profile_decision IS DISTINCT FROM 'OVERRIDDEN'
       AND profile_override_reason IS NULL)
  ),

  -- CANNOT JUDGE never counts as confirmation (§6.3). It is the one outcome
  -- that leaves the profile not human-confirmed, which is what raises
  -- PROFILE NOT CONFIRMED, drops trust to PARTIAL, and suppresses the §10.6
  -- position while the fair-value range still renders (§10.6.3).
  CONSTRAINT profile_human_confirmed_matches_decision CHECK (
    (profile_decision IS NULL          AND profile_human_confirmed = FALSE)
    OR
    (profile_decision = 'CANNOT JUDGE' AND profile_human_confirmed = FALSE)
    OR
    (profile_decision IN ('CONFIRMED', 'OVERRIDDEN')
       AND profile_human_confirmed = TRUE)
  )
);

-- 2. analyzer_run_fact_decisions
--
-- One row per queued material fact that has been decided. Step 2 offers
-- exactly two decisions and no default (§3.8.3); a fact with no row here has
-- not been decided, which is what the ordering-rule gate reads.
--
-- Spot-check completeness is DERIVED — every queued fact carries a decision
-- (§3.8.1) — and is deliberately not stored as a flag on analyzer_runs. A
-- denormalised "complete" boolean can drift from the decisions it claims to
-- summarise, and the §2 ordering rule is the one thing in this milestone that
-- must not be able to drift.
CREATE TABLE analyzer_run_fact_decisions (
  run_id      UUID NOT NULL REFERENCES analyzer_runs(run_id) ON DELETE CASCADE,
  -- FactRecord.id (lib/analyzer/types.ts) — e.g. 'finance-lease-rou-additions'.
  -- Not a foreign key: facts are not rows, they are the fact set carried in
  -- the Analysis Result.
  fact_id     TEXT NOT NULL,

  -- §3.8.3 binds the interface labels to this vocabulary in exactly one place:
  -- "Confirm" -> CONFIRMED, "Cannot verify" -> NOT CONFIRMED. The strings
  -- stored here are that vocabulary verbatim, so no third mapping exists.
  decision    TEXT NOT NULL
                CHECK (decision IN ('CONFIRMED', 'NOT CONFIRMED')),

  reason_code TEXT
                CHECK (reason_code IN ('CONTRADICTED BY SOURCE', 'NOT LOCATED')),

  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (run_id, fact_id),

  -- §3.8.4: "A non-confirmation is not complete without a reason code."
  -- This constraint is the reason Option A was chosen over an in-memory or
  -- filesystem store: the rule is enforced where it cannot be bypassed —
  -- not by a route handler, not by the form — on the same argument R7 makes
  -- for the Step 2 gate being server-side. An UPDATE that clears the reason
  -- code while leaving the decision at NOT CONFIRMED fails here too.
  CONSTRAINT reason_code_required_on_non_confirmation CHECK (
    (decision = 'NOT CONFIRMED' AND reason_code IS NOT NULL)
    OR
    (decision = 'CONFIRMED'     AND reason_code IS NULL)
  )
);

-- 3. analyzer_run_judgments
--
-- The three §4.4 inputs that are labelled FACT in the methodology and are not.
-- R6 (approved 7 September 2026) places these in Step 2, not Step 6, which is
-- why they are keyed to the run alongside the fact decisions rather than
-- sitting on the profile columns above.
CREATE TABLE analyzer_run_judgments (
  run_id       UUID NOT NULL REFERENCES analyzer_runs(run_id) ON DELETE CASCADE,

  judgment_key TEXT NOT NULL CHECK (judgment_key IN (
    -- Restate every year, or shorten the window; the two give different
    -- answers and §3.7 requires recording which was done.
    'ACCOUNTING-BASIS WINDOW',
    -- Which investments are non-operating — a classification, not a
    -- reported line.
    'NON-OPERATING INVESTMENTS',
    -- The window used for median-margin NOPAT. Named per I15: the interface
    -- term is median-margin NOPAT, never the methodology's "normalised".
    'MEDIAN-MARGIN NOPAT WINDOW'
  )),

  -- What the analyst selected or confirmed. Held as free text because the
  -- option set differs per judgment — a window basis, a set of line items, a
  -- period — and the spec freezes none of those strings. Constraining them
  -- here would invent vocabulary the contract does not define.
  selection    TEXT NOT NULL,

  -- §4.4: "the confirmation is recorded with its reason". Nullable pending a
  -- Command Center ruling: unlike §3.8.4, §4.4 carries no "not complete
  -- without" language, so requiring it here would be a constraint the
  -- contract does not state. Tightening to NOT NULL later is one ALTER.
  reason       TEXT,

  decided_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (run_id, judgment_key)
);
