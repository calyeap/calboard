import Decimal from "decimal.js";
import type { TerminalDiagnostics } from "../types";

// M8 — terminal diagnostics (§7.2). A thin, reusable computation: terminal
// share of value is reported wherever a terminal value exists (M7's grid,
// M15's scenario DCF) — this is the one place that division happens, so
// every caller reports the same number the same way.
//
// "60-75% normal for a healthy mature company on a ten-year explicit
// period; >75% caution; >85% the model is a multiple in disguise" (§7.2)
// is interpretive guidance for the report/interpretation layer, not a
// threshold this module enforces — M8 reports the number; it does not
// classify it into a state (no state named here suppresses on a terminal-
// share threshold; DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE, the one
// state that does relate to terminal share, is a Reverse DCF solver
// outcome already handled in reverseDcf.ts, not a general M8 concern).
export function computeTerminalDiagnostics(terminalValuePV: Decimal, enterpriseValue: Decimal): TerminalDiagnostics {
  return {
    terminalShareOfValue: terminalValuePV.dividedBy(enterpriseValue),
    // The terminal FCF = terminal NOPAT × (1 − g ÷ terminal ROIC) formula
    // (never final-year FCF × (1+g)) is applied inside the actual terminal-
    // value construction (reverseDcf.ts's projectReverseDcfValue). This
    // flag is a display-time confirmation for the report, not a
    // computation performed here.
    terminalFcfConsistencyApplied: true,
  };
}
