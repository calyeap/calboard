"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggle: () => {},
});

// Session-only, same shape as PrivacyProvider: plain useState, mounted once
// in the root layout, no persistence. Server-rendered/first paint is always
// "light" (matchMedia doesn't exist on the server); a mount effect then
// reads the OS preference once. A brief light->dark flash for dark-OS users
// on first load is the accepted trade-off for keeping this as simple as
// PrivacyContext (no blocking inline script, no localStorage).
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  const toggle = () => setTheme((t) => (t === "light" ? "dark" : "light"));
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
