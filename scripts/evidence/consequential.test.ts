import { describe, it, expect } from "vitest";
import { describeLostWrite, LostWriteError, type InspectionReport } from "./consequential";

const WRITE = { operation: "Begin analysis", ticker: "MSFT", runId: null };
const INSPECTED: InspectionReport = {
  performed: true,
  findings: ["1 analyzer run for MSFT created in the last 5 minutes: 9f2c… at 11:08:14Z"],
  beforeRetry: "confirm whether that run is this dispatch's before creating another",
};

describe("describeLostWrite", () => {
  // §5.5: a write whose response was lost is UNKNOWN. It is not a FAIL —
  // nothing was measured to be wrong, the answer simply never came back.
  it("is UNKNOWN, never FAIL", () => {
    expect(describeLostWrite(WRITE, INSPECTED).status).toBe("UNKNOWN");
  });

  it("names the write whose response was lost", () => {
    const r = describeLostWrite(WRITE, INSPECTED);
    expect(r.step).toContain("Begin analysis");
    expect(r.step).toContain("MSFT");
  });

  it("carries what the inspection actually found", () => {
    expect(describeLostWrite(WRITE, INSPECTED).detail).toContain("9f2c");
  });

  // "Inspect current state before any retry" is only useful if the report
  // says what to inspect.
  it("states what must be confirmed before retrying", () => {
    expect(describeLostWrite(WRITE, INSPECTED).detail).toContain("before creating another");
  });

  it("stays UNKNOWN, and says so, when the inspection itself could not run", () => {
    const r = describeLostWrite(WRITE, {
      performed: false,
      findings: ["database unreachable: connection refused"],
      beforeRetry: "inspect analyzer_runs by hand before retrying",
    });
    expect(r.status).toBe("UNKNOWN");
    expect(r.detail).toContain("could not be inspected");
  });

  it("names the run when the lost write was against an existing one", () => {
    const r = describeLostWrite(
      { operation: "record decision", ticker: "OKLO", runId: "abc-123" },
      INSPECTED
    );
    expect(r.detail).toContain("abc-123");
  });
});

describe("LostWriteError", () => {
  it("carries the write and the inspection to the caller that must report them", () => {
    const e = new LostWriteError(WRITE, INSPECTED);
    expect(e.write.operation).toBe("Begin analysis");
    expect(e.inspected.findings).toHaveLength(1);
    expect(e).toBeInstanceOf(Error);
  });
});
