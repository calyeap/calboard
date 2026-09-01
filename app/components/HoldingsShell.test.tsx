// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ThemeProvider } from "./ThemeContext";
import { HoldingsShell } from "./HoldingsShell";

afterEach(cleanup);

describe("HoldingsShell", () => {
  it("renders the .holdings-chrome wrapper with data-theme matching the shared theme value", () => {
    const { container } = render(
      <ThemeProvider>
        <HoldingsShell>
          <p>content</p>
        </HoldingsShell>
      </ThemeProvider>
    );
    const wrapper = container.querySelector(".holdings-chrome")!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.getAttribute("data-theme")).toBe("light");
    expect(wrapper.textContent).toContain("content");
  });

  it("defaults to light with no provider (isolated component tests)", () => {
    const { container } = render(
      <HoldingsShell>
        <p>content</p>
      </HoldingsShell>
    );
    expect(container.querySelector(".holdings-chrome")?.getAttribute("data-theme")).toBe("light");
  });
});
