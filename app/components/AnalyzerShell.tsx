"use client";

import type { ReactNode } from "react";
import { useTheme } from "./ThemeContext";

// The scoping boundary for the Stock Analyzer's report tokens (Milestone
// 6), same pattern as DashboardShell/.cb-dash and HoldingsShell/
// .holdings-chrome — a parallel token set, not a shared one.
export function AnalyzerShell({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <div className="cb-analyzer" data-theme={theme}>
      {children}
    </div>
  );
}
