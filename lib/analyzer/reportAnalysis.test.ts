import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool } from "./../db";
import { createRun, recordFactDecision } from "./runStore";
import { loadGateState } from "./gate";
import { analysisForReport } from "./reportAnalysis";
import { INTERPRETATION_RESPONSIBILITIES, INTERPRETATION_RESPONSIBILITY_KEYS } from "./types";
import type { AnalystCall, AnalystCallRequest } from "./ai/analystCall";

// The AI layer as the report sees it. §8.1 draws the boundary this file
// exercises: "Deterministic code handles calculations, gates, states and
// rules. AI interprets, explains, challenges and summarises." So the report
// must render the whole deterministic analysis whether or not either call ran.

const STATEMENT = "The price rests on growth this company has not yet delivered.";

function scriptedCall(seen: AnalystCallRequest[] = []): AnalystCall {
  return async (request) => {
    seen.push(request);
    if (request.label === "interpretation") {
      return {
        statements: Object.fromEntries(
          INTERPRETATION_RESPONSIBILITY_KEYS.map((key, i) => [
            key,
            i === 2 ? STATEMENT : "Nothing further on this responsibility for this run.",
          ])
        ),
        pageOne: {
          mainFinding: STATEMENT,
          whatSupportsTheCase: "Returns on new capital sit above the policy rates.",
          whatWorriesCalboard: "The margin sits at the top of its own history.",
          biggestUncertainty: "Which margin level is the right base for the grid.",
        },
      };
    }
    return { findings: [] };
  };
}

async function decidedRun(ticker: string, companyName: string): Promise<string> {
  const runId = await createRun(ticker, companyName);
  const state = await loadGateState(runId);
  for (const factId of state.outstandingFactIds) {
    await recordFactDecision(runId, factId, "CONFIRMED", null);
  }
  return runId;
}

describe("analysisForReport", () => {
  beforeEach(async () => {
    await getPool().query(
      "TRUNCATE analyzer_run_ai_outputs, analyzer_run_fact_decisions, analyzer_run_judgments, analyzer_runs CASCADE"
    );
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("renders the whole deterministic analysis when no call is configured — §8.1's boundary is that the numbers do not depend on it", async () => {
    const runId = await decidedRun("MSFT", "Microsoft Corporation");

    const report = await analysisForReport(runId, null);

    expect(report.aiLayer.status).toBe("NOT CONFIGURED");
    expect(report.result.priceImplied.reverseDcfGrid).toHaveLength(9);
    expect(report.result.interpretation.statements).toEqual([]);
    expect(report.result.interpretation.pageOne).toBeNull();
    expect(report.result.challenger).toBeNull();
  });

  it("runs both calls and merges them once the analysis exists", async () => {
    const runId = await decidedRun("MSFT", "Microsoft Corporation");
    const seen: AnalystCallRequest[] = [];

    const report = await analysisForReport(runId, scriptedCall(seen));

    expect(report.aiLayer.status).toBe("COMPLETED");
    expect(seen.map((r) => r.label).sort()).toEqual(["challenger", "interpretation"]);
    expect(report.result.interpretation.statements[2].statement).toBe(STATEMENT);
    expect(report.result.challenger).not.toBeNull();
  });

  it("calls once per run — a refresh reads the stored words rather than rolling new ones", async () => {
    const runId = await decidedRun("MSFT", "Microsoft Corporation");
    const seen: AnalystCallRequest[] = [];

    await analysisForReport(runId, scriptedCall(seen));
    const second = await analysisForReport(runId, scriptedCall(seen));

    expect(seen).toHaveLength(2);
    expect(second.aiLayer.status).toBe("COMPLETED");
    expect(second.result.interpretation.statements[2].statement).toBe(STATEMENT);
  });

  it("keeps the analysis when a call fails, and says why rather than inventing prose", async () => {
    const runId = await decidedRun("MSFT", "Microsoft Corporation");
    const failing: AnalystCall = async () => {
      throw new Error("the model was unreachable");
    };

    const report = await analysisForReport(runId, failing);

    expect(report.aiLayer.status).toBe("FAILED");
    expect(report.aiLayer.detail).toContain("unreachable");
    expect(report.result.interpretation.statements).toEqual([]);
    expect(report.result.challenger).toBeNull();
    expect(report.result.priceImplied.reverseDcfGrid).toHaveLength(9);
  });

  it("keeps the analysis when [C] returns a figure that does not trace, and refuses the prose entirely", async () => {
    const runId = await decidedRun("MSFT", "Microsoft Corporation");
    const untraceable: AnalystCall = async (request) => {
      if (request.label === "interpretation") {
        return {
          statements: Object.fromEntries(
            INTERPRETATION_RESPONSIBILITY_KEYS.map((key, i) => [key, i === 2 ? "Growth of 14.2% is implied." : "Clean."])
          ),
          pageOne: {
            mainFinding: "x",
            whatSupportsTheCase: "y",
            whatWorriesCalboard: "z",
            biggestUncertainty: "w",
          },
        };
      }
      return { findings: [] };
    };

    const report = await analysisForReport(runId, untraceable);

    expect(report.aiLayer.status).toBe("FAILED");
    expect(report.aiLayer.detail).toContain("NUMERAL FROM MODEL");
    expect(report.result.interpretation.statements).toEqual([]);
    expect(report.result.challenger).toBeNull();
  });

  it("logs a refusal without console.error, so an expected refusal is not raised as a crash", async () => {
    // RULED. A fail-closed refusal is designed behaviour. Next's development
    // overlay hooks console.error, so logging there rendered correct operation
    // as a red crash screen — which made an acceptance run unreadable and made
    // a working control indistinguishable from a defect.
    const runId = await decidedRun("MSFT", "Microsoft Corporation");
    const seenOnConsole: unknown[] = [];
    const seenOnStderr: string[] = [];
    const realConsoleError = console.error;
    const realStderrWrite = process.stderr.write.bind(process.stderr);
    console.error = (...args: unknown[]) => {
      seenOnConsole.push(args);
    };
    process.stderr.write = ((chunk: string | Uint8Array) => {
      seenOnStderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const report = await analysisForReport(runId, async () => {
        throw Object.assign(new Error("refused"), { diagnostic: 'NUMERAL FROM MODEL ("14.2%")' });
      });

      expect(report.aiLayer.status).toBe("FAILED");
      expect(seenOnConsole).toEqual([]);
      // Nothing is lost — the full diagnostic still reaches the log.
      expect(seenOnStderr.join("")).toContain('NUMERAL FROM MODEL ("14.2%")');
    } finally {
      console.error = realConsoleError;
      process.stderr.write = realStderrWrite;
    }
  });

  describe("a generation already in flight", () => {
    /** Counts model calls and takes long enough for requests to overlap. */
    function slowCountingCall(counter: { calls: number }): AnalystCall {
      return async (request) => {
        counter.calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
        return request.label === "interpretation"
          ? {
              statements: Object.fromEntries(
                INTERPRETATION_RESPONSIBILITY_KEYS.map((key) => [key, "Nothing further on this responsibility."])
              ),
              pageOne: {
                mainFinding: "A.",
                whatSupportsTheCase: "B.",
                whatWorriesCalboard: "C.",
                biggestUncertainty: "D.",
              },
            }
          : { findings: [] };
      };
    }

    it("serves three overlapping requests from ONE generation, not three", async () => {
      // A page that looks stuck for the best part of a minute is a page people
      // refresh, and every refresh used to start its own generation: three
      // requests, six model calls, one row, and nothing anywhere saying it had
      // happened. The last write silently won.
      const runId = await decidedRun("MSFT", "Microsoft Corporation");
      const counter = { calls: 0 };
      const call = slowCountingCall(counter);

      const reports = await Promise.all([
        analysisForReport(runId, call),
        analysisForReport(runId, call),
        analysisForReport(runId, call),
      ]);

      expect(counter.calls).toBe(2); // one interpretation, one challenger
      for (const report of reports) {
        expect(report.aiLayer.status).toBe("COMPLETED");
        expect(report.result.challenger).not.toBeNull();
      }
    });

    it("gives every waiting request the same prose, so a refresh does not change the words", async () => {
      const runId = await decidedRun("MSFT", "Microsoft Corporation");
      const call = slowCountingCall({ calls: 0 });

      const [first, second] = await Promise.all([
        analysisForReport(runId, call),
        analysisForReport(runId, call),
      ]);

      expect(second.result.interpretation).toEqual(first.result.interpretation);
      expect(second.result.challenger).toEqual(first.result.challenger);
    });

    it("starts a fresh generation once the first has finished — the guard is in-flight only, not a cache", async () => {
      const runId = await decidedRun("MSFT", "Microsoft Corporation");
      const counter = { calls: 0 };

      await analysisForReport(runId, slowCountingCall(counter));
      // Second request arrives after the first completed. It reads the run's
      // stored outputs (migration 003) rather than the guard, and calls nothing.
      await analysisForReport(runId, slowCountingCall(counter));

      expect(counter.calls).toBe(2);
    });

    it("lets the next request try again after a failed generation, rather than latching the failure", async () => {
      const runId = await decidedRun("MSFT", "Microsoft Corporation");
      let attempts = 0;
      const failing: AnalystCall = async () => {
        attempts += 1;
        throw new Error("the model was unreachable");
      };

      const first = await analysisForReport(runId, failing);
      const second = await analysisForReport(runId, failing);

      expect(first.aiLayer.status).toBe("FAILED");
      expect(second.aiLayer.status).toBe("FAILED");
      // Both requests reached the model; nothing is stuck holding a dead entry.
      expect(attempts).toBeGreaterThan(2);
    });
  });

  it("does the same for OKLO, whose pre-revenue analysis suppresses most of the grid", async () => {
    const runId = await decidedRun("OKLO", "Oklo Inc.");

    const report = await analysisForReport(runId, scriptedCall());

    expect(report.aiLayer.status).toBe("COMPLETED");
    expect(report.result.preRevenue).not.toBeNull();
    expect(report.result.interpretation.statements[2].statement).toBe(STATEMENT);
  });
});
