"use client";

import type { ReactNode } from "react";
import { useTheme } from "./ThemeContext";

// The scoping boundary for Dashboard's redesigned visual system (tokens,
// IBM Plex Sans, the six-value allocation palette, dark mode). Holdings
// now has its own comparable scoped system via HoldingsShell
// (/holdings/.../HoldingsShell.tsx); only the setup wizard (/accounts/new)
// and NavBar remain on the original untouched foundation.
export function DashboardShell({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <div className="cb-dash" data-theme={theme}>
      {children}
    </div>
  );
}
