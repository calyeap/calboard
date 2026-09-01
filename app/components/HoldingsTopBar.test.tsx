// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PrivacyProvider, usePrivacy } from "./PrivacyContext";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { HoldingsTopBar } from "./HoldingsTopBar";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <PrivacyProvider>{children}</PrivacyProvider>
    </ThemeProvider>
  );
}

describe("HoldingsTopBar", () => {
  it("marks Holdings as the active link and links to Dashboard", () => {
    render(
      <Providers>
        <HoldingsTopBar />
      </Providers>
    );
    expect(screen.getByRole("link", { name: /^holdings$/i })).toHaveClass("on");
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("href", "/");
  });

  it("privacy toggle button shares state with usePrivacy() consumers", () => {
    function Probe() {
      const { hidden } = usePrivacy();
      return <span data-testid="hidden">{String(hidden)}</span>;
    }
    render(
      <Providers>
        <HoldingsTopBar />
        <Probe />
      </Providers>
    );

    fireEvent.click(screen.getByRole("button", { name: /hide values/i }));
    expect(screen.getByTestId("hidden").textContent).toBe("true");
    expect(screen.getByRole("button", { name: /show values/i })).toBeInTheDocument();
  });

  it("theme toggle button shares state with useTheme() consumers", () => {
    function Probe() {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    }
    render(
      <Providers>
        <HoldingsTopBar />
        <Probe />
      </Providers>
    );

    fireEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeInTheDocument();
  });
});
