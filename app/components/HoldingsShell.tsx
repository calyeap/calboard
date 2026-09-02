"use client";

import type { ReactNode } from "react";
import { useTheme } from "./ThemeContext";

// The scoping boundary for Holdings' dark-mode support (2026-09-01): reads
// the SAME shared ThemeContext Dashboard's toggle drives — not a second
// theme mechanism — and scopes ".holdings-chrome" (app/globals.css) to
// exactly this wrapper. ".holdings-chrome" is a full, self-contained token
// system covering both themes for every control (inputs, the asset-type
// select, buttons included), mirroring ".cb-dash"'s approach in
// DashboardShell.tsx above.
export function HoldingsShell({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <div className="holdings-chrome" data-theme={theme}>
      {children}
    </div>
  );
}
