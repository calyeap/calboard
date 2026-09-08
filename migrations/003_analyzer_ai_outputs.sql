-- 003_analyzer_ai_outputs.sql
-- Milestone M8-b — the §8.2 interpretation layer and the §8.5 blind
-- challenger, persisted per run.
--
-- WHY THIS IS STORED AT ALL, when nothing else the analyzer computes is.
-- Every other output in this system is a deterministic function of its inputs:
-- run it twice, get the same answer, so there is nothing to keep. These two are
-- not. The same fact set can produce different words, which makes a [C] output
-- an EVENT rather than a derivation — it happened once, at a time, on a model,
-- and a report that re-rolled its prose on every refresh would be showing the
-- reader something other than the analysis they were looking at a moment ago.
--
-- It also makes §8.5.4 expressible. "The challenger's output is merged into the
-- final report only after the independent call has completed" is a statement
-- about ordering, and ordering needs a moment recorded. `completed_at` is that
-- moment, and it is NOT NULL because a row for a call that has not completed
-- would be the thing §8.5.4 forbids.
--
-- THE PORTFOLIO BOUNDARY of 002 is unchanged and re-stated here: the only
-- REFERENCES clause below is analyzer -> analyzer.

CREATE TABLE analyzer_run_ai_outputs (
  run_id       UUID NOT NULL REFERENCES analyzer_runs(run_id) ON DELETE CASCADE,

  -- Two kinds, and exactly two. §8.3 limit 6 and §13.1 forbid a panel: no
  -- personas, no voting, no synthesis of several generated opinions. The
  -- primary key below is (run_id, kind), so a run physically cannot hold two
  -- challenger opinions to tally against each other — the constraint is the
  -- prohibition, not a comment about it.
  kind         TEXT NOT NULL CHECK (kind IN ('INTERPRETATION', 'CHALLENGER')),

  -- Which model wrote this prose. A model choice is an input that changes the
  -- output, and §3's whole argument is that such an input belongs in the
  -- record rather than in someone's memory of how the run was configured.
  model        TEXT NOT NULL,

  -- The validated, rendered output — InterpretationResult or ChallengerResult
  -- (lib/analyzer/types.ts). Stored AFTER the §8.3 limit checks have passed,
  -- so nothing reaches this table carrying a figure that does not trace to the
  -- Analysis Result. A raw model response is deliberately not kept: it would
  -- be a second copy of the prose that no check has been run against, and the
  -- first thing anyone would do with it is read it.
  payload      JSONB NOT NULL,

  -- §8.5.4. NOT NULL, and set from the completion of the call itself rather
  -- than defaulted at insert.
  completed_at TIMESTAMPTZ NOT NULL,

  PRIMARY KEY (run_id, kind)
);
