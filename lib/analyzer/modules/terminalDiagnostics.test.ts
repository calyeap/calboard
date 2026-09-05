import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeTerminalDiagnostics } from "./terminalDiagnostics";

describe("computeTerminalDiagnostics", () => {
  it("computes terminal share of value as terminal PV / total EV", () => {
    const result = computeTerminalDiagnostics(new Decimal(300), new Decimal(1000));
    expect(result.terminalShareOfValue.toString()).toBe("0.3");
  });

  it("always reports the consistency flag as applied", () => {
    const result = computeTerminalDiagnostics(new Decimal(1), new Decimal(2));
    expect(result.terminalFcfConsistencyApplied).toBe(true);
  });

  it("reports a low terminal share as information too, not suppressed or flagged specially", () => {
    const result = computeTerminalDiagnostics(new Decimal(50), new Decimal(1000));
    expect(result.terminalShareOfValue.toString()).toBe("0.05");
  });
});
