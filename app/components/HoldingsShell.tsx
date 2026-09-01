"use client";

import type { ReactNode } from "react";
import { useTheme } from "./ThemeContext";

// Minimal dark-mode chrome for Holdings (2026-09-0X): reads the SAME shared
// ThemeContext Dashboard's toggle drives — not a second theme mechanism —
// and scopes the new dark CSS (app/globals.css, ".holdings-chrome" section)
// to exactly this wrapper. Form controls (inputs, the asset-type select,
// buttons) are deliberately left native/light inside it; only static chrome
// (background, text, nav, table borders/header) responds. Full Holdings
// dark-mode support (including form controls) is a separate future
// milestone — this is intentionally a visual seam, not an oversight.
export function HoldingsShell({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <div className="holdings-chrome" data-theme={theme}>
      {children}
    </div>
  );
}
