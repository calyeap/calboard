"use client";

import type { ReactNode } from "react";
import { useTheme } from "./ThemeContext";

// The scoping boundary for the whole redesigned visual system (tokens,
// IBM Plex Sans, the six-value allocation palette, dark mode). Everything
// outside this wrapper — /holdings, the setup wizard, NavBar — is
// deliberately untouched this milestone.
export function DashboardShell({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <div className="cb-dash" data-theme={theme}>
      {children}
    </div>
  );
}
