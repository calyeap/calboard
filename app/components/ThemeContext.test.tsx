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
});
