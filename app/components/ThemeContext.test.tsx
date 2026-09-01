// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle}>
      {theme}
    </button>
  );
}

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

describe("ThemeContext", () => {
  it("defaults to light with no provider (isolated component tests)", () => {
    render(<Probe />);
    expect(screen.getByRole("button").textContent).toBe("light");
  });

  it("adopts the OS dark preference on mount", () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByRole("button").textContent).toBe("dark");
  });

  it("stays light when the OS prefers light", () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByRole("button").textContent).toBe("light");
  });

  it("toggle flips the theme regardless of OS preference, for the session", () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("dark");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("light");
  });

  it("theme survives a simulated client-side route change — the same ThemeProvider instance, only its children swapped", () => {
    // Models exactly what Next.js App Router does on navigation: the root
    // layout (and everything mounted in it, including ThemeProvider) is
    // never remounted — only the page segment below it swaps out. Same
    // component type at the same tree position => React reconciles this as
    // an update, not an unmount/remount, so useState here must survive it.
    function DashboardStandIn() {
      const { theme, toggle } = useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <button type="button" onClick={toggle}>
            toggle
          </button>
        </div>
      );
    }
    function HoldingsStandIn() {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    }

    mockMatchMedia(false);
    const { rerender } = render(
      <ThemeProvider>
        <DashboardStandIn />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("theme").textContent).toBe("dark");

    // "Navigate" to Holdings: swap the child under the SAME <ThemeProvider>.
    rerender(
      <ThemeProvider>
        <HoldingsStandIn />
      </ThemeProvider>
    );

    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });
});
