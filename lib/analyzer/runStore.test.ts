import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool } from "../db";
import {
  createRun,
  getRun,
  recordFactDecision,
  getFactDecisions,
  getDecidedFactIds,
  recordJudgment,
  getJudgments,
  recordProfileDecision,
} from "./runStore";

describe("runStore", () => {
  beforeEach(async () => {
    // analyzer_run_fact_decisions and analyzer_run_judgments cascade from
    // analyzer_runs, but naming all three keeps this independent of that.
    await getPool().query(
      "TRUNCATE analyzer_run_fact_decisions, analyzer_run_judgments, analyzer_runs CASCADE"
    );
  });

  afterAll(async () => {
    await getPool().end();
  });

  describe("createRun", () => {
    it("returns an unguessable v4 UUID, not a sequential id", async () => {
      const runId = await createRun("MSFT", "Microsoft Corporation");
      expect(runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("gives two runs of the same ticker different, non-adjacent ids", async () => {
      const a = await createRun("MSFT", "Microsoft Corporation");
      const b = await createRun("MSFT", "Microsoft Corporation");
      expect(a).not.toBe(b);
      // R7's property: knowing one runId must not lead you to another.
      expect(Math.abs(parseInt(a.slice(0, 8), 16) - parseInt(b.slice(0, 8), 16))).toBeGreaterThan(1);
    });

    it("round-trips the confirmed identity", async () => {
      const runId = await createRun("OKLO", "Oklo Inc.");
      const run = await getRun(runId);
      expect(run).toMatchObject({
        runId,
        ticker: "OKLO",
        resolvedCompanyName: "Oklo Inc.",
        profileDecision: null,
        profileHumanConfirmed: false,
      });
    });
  });

  describe("getRun", () => {
    it("returns null for a well-formed id that does not exist", async () => {
      expect(await getRun("11111111-1111-4111-8111-111111111111")).toBeNull();
    });

    // runIds arrive from the URL bar, where anything can be typed.
    it("returns null rather than throwing for a malformed id", async () => {
      expect(await getRun("not-a-uuid")).toBeNull();
      expect(await getRun("")).toBeNull();
      expect(await getRun("'; DROP TABLE analyzer_runs; --")).toBeNull();
    });

    it("has not dropped the table on that last one", async () => {
      const runId = await createRun("MSFT", "Microsoft Corporation");
      expect(await getRun(runId)).not.toBeNull();
    });
  });

  describe("recordFactDecision", () => {
    let runId: string;
    beforeEach(async () => {
      runId = await createRun("MSFT", "Microsoft Corporation");
    });

    it("records a confirmation with no reason code", async () => {
      await recordFactDecision(runId, "capex", "CONFIRMED", null);
      expect(await getFactDecisions(runId)).toEqual([
        { factId: "capex", decision: "CONFIRMED", reasonCode: null },
      ]);
    });

    it("records a non-confirmation with each of the two reason codes", async () => {
      await recordFactDecision(runId, "capex", "NOT CONFIRMED", "CONTRADICTED BY SOURCE");
      await recordFactDecision(runId, "price", "NOT CONFIRMED", "NOT LOCATED");
      const byId = Object.fromEntries(
        (await getFactDecisions(runId)).map((d) => [d.factId, d.reasonCode])
      );
      expect(byId).toEqual({ capex: "CONTRADICTED BY SOURCE", price: "NOT LOCATED" });
    });

    // §3.8.4 — the rule that made Option A worth a migration.
    it("refuses Cannot verify without a reason code", async () => {
      await expect(recordFactDecision(runId, "capex", "NOT CONFIRMED", null)).rejects.toThrow(
        /reason code/i
      );
      expect(await getFactDecisions(runId)).toHaveLength(0);
    });

    it("refuses Confirm carrying a reason code", async () => {
      await expect(
        recordFactDecision(runId, "capex", "CONFIRMED", "NOT LOCATED")
      ).rejects.toThrow(/reason code/i);
    });

    // The application check above is a legibility convenience. This proves the
    // database refuses the same row when that check is bypassed entirely, which
    // is the actual enforcement.
    it("is refused by the database even when the application check is bypassed", async () => {
      await expect(
        getPool().query(
          `INSERT INTO analyzer_run_fact_decisions (run_id, fact_id, decision, reason_code)
           VALUES ($1, 'smuggled', 'NOT CONFIRMED', NULL)`,
          [runId]
        )
      ).rejects.toThrow(/reason_code_required_on_non_confirmation/);
    });

    it("lets an analyst change a decision before the step completes", async () => {
      await recordFactDecision(runId, "capex", "CONFIRMED", null);
      await recordFactDecision(runId, "capex", "NOT CONFIRMED", "NOT LOCATED");
      expect(await getFactDecisions(runId)).toEqual([
        { factId: "capex", decision: "NOT CONFIRMED", reasonCode: "NOT LOCATED" },
      ]);
    });

    it("keeps decisions of different runs apart", async () => {
      const other = await createRun("OKLO", "Oklo Inc.");
      await recordFactDecision(runId, "capex", "CONFIRMED", null);
      expect(await getDecidedFactIds(other)).toEqual(new Set());
      expect(await getDecidedFactIds(runId)).toEqual(new Set(["capex"]));
    });
  });

  describe("judgments (§4.4, placed in Step 2 by R6)", () => {
    it("records and updates each of the three, with an optional reason", async () => {
      const runId = await createRun("MSFT", "Microsoft Corporation");
      await recordJudgment(runId, "ACCOUNTING-BASIS WINDOW", "SHORTEN WINDOW", "FY2017–FY2026");
      await recordJudgment(runId, "NON-OPERATING INVESTMENTS", "equity-method stakes", null);
      await recordJudgment(runId, "MEDIAN-MARGIN NOPAT WINDOW", "10 years", null);

      const judgments = await getJudgments(runId);
      expect(judgments).toHaveLength(3);
      expect(judgments.find((j) => j.judgmentKey === "ACCOUNTING-BASIS WINDOW")).toEqual({
        judgmentKey: "ACCOUNTING-BASIS WINDOW",
        selection: "SHORTEN WINDOW",
        reason: "FY2017–FY2026",
      });

      await recordJudgment(runId, "ACCOUNTING-BASIS WINDOW", "RESTATE ALL", null);
      const updated = await getJudgments(runId);
      expect(updated).toHaveLength(3);
      expect(updated.find((j) => j.judgmentKey === "ACCOUNTING-BASIS WINDOW")?.selection).toBe(
        "RESTATE ALL"
      );
    });

    it("refuses a judgment key outside §4.4's three", async () => {
      const runId = await createRun("MSFT", "Microsoft Corporation");
      await expect(
        getPool().query(
          `INSERT INTO analyzer_run_judgments (run_id, judgment_key, selection)
           VALUES ($1, 'INVENTED JUDGMENT', 'x')`,
          [runId]
        )
      ).rejects.toThrow(/judgment_key_check/);
    });
  });

  describe("recordProfileDecision (§6.3)", () => {
    let runId: string;
    beforeEach(async () => {
      runId = await createRun("MSFT", "Microsoft Corporation");
    });

    it("records a confirmation as human-confirmed", async () => {
      await recordProfileDecision(runId, "CONFIRMED", "Mature, profitable, stable FCF", null);
      const run = await getRun(runId);
      expect(run).toMatchObject({
        profileDecision: "CONFIRMED",
        profile: "Mature, profitable, stable FCF",
        profileOverrideReason: null,
        profileHumanConfirmed: true,
      });
    });

    it("records an override with its free-text reason, as human-confirmed", async () => {
      await recordProfileDecision(
        runId,
        "OVERRIDDEN",
        "High-growth, profitable, uncertain durability",
        "Azure reacceleration makes the mature profile wrong for FY2026"
      );
      const run = await getRun(runId);
      expect(run?.profileHumanConfirmed).toBe(true);
      expect(run?.profileOverrideReason).toMatch(/Azure reacceleration/);
    });

    it("refuses an override with no reason", async () => {
      await expect(
        recordProfileDecision(runId, "OVERRIDDEN", "Pre-revenue / unprofitable", null)
      ).rejects.toThrow(/reason/i);
      await expect(
        recordProfileDecision(runId, "OVERRIDDEN", "Pre-revenue / unprofitable", "   ")
      ).rejects.toThrow(/reason/i);
    });

    // §6.3: Cannot judge records no reason, and never counts as confirmation.
    it("records Cannot judge with no reason and as NOT human-confirmed", async () => {
      await recordProfileDecision(runId, "CANNOT JUDGE", "Mature, profitable, stable FCF", null);
      const run = await getRun(runId);
      expect(run).toMatchObject({
        profileDecision: "CANNOT JUDGE",
        profile: "Mature, profitable, stable FCF",
        profileOverrideReason: null,
        profileHumanConfirmed: false,
      });
    });

    it("refuses a reason on Cannot judge", async () => {
      await expect(
        recordProfileDecision(runId, "CANNOT JUDGE", "Mature, profitable, stable FCF", "a reason")
      ).rejects.toThrow(/reason/i);
    });

    // The 7 September ruling, enforced below the code that could get it wrong.
    it("is refused by the database if Cannot judge is smuggled in as confirmed", async () => {
      await expect(
        getPool().query(
          `UPDATE analyzer_runs
              SET profile_decision = 'CANNOT JUDGE', profile = 'Mature, profitable, stable FCF',
                  profile_decided_at = now(), profile_human_confirmed = TRUE
            WHERE run_id = $1`,
          [runId]
        )
      ).rejects.toThrow(/profile_human_confirmed_matches_decision/);
    });
  });

  // R7: lose the URL and the run is gone. There is no listing surface, so
  // this is asserted against the module's own exports.
  it("exposes no way to list or search runs", async () => {
    const store = await import("./runStore");
    const listingLike = Object.keys(store).filter((k) =>
      /list|all|search|find|recent|history|index/i.test(k)
    );
    expect(listingLike).toEqual([]);
  });
});
