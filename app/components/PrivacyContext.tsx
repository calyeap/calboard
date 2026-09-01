"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface PrivacyContextValue {
  hidden: boolean;
  toggle: () => void;
}

// Default value lets any consumer render without a <PrivacyProvider>
// ancestor (e.g. existing page-level tests that render a page's output in
// isolation) — it just behaves as always-visible, matching pre-toggle
// behaviour exactly.
const PrivacyContext = createContext<PrivacyContextValue>({
  hidden: false,
  toggle: () => {},
});

// In-memory only (spec: no localStorage, no stored data changes). Mounted
// once in the root layout, which App Router never remounts on client-side
// navigation, so this state survives navigating between routes.
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const toggle = () => setHidden((h) => !h);
  return <PrivacyContext.Provider value={{ hidden, toggle }}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext);
}
