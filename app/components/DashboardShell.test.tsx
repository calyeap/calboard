// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ThemeProvider } from "./ThemeContext";
import { DashboardShell } from "./DashboardShell";

afterEach(cleanup);

describe("DashboardShell", () => {
  it("renders the .cb-dash wrapper with data-theme matching the current theme", () => {
    const { container } = render(
      <ThemeProvider>
        <DashboardShell>
          <p>content</p>
        </DashboardShell>
      </ThemeProvider>
    );
    const wrapper = container.querySelector(".cb-dash")!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.getAttribute("data-theme")).toBe("light");
    expect(wrapper.textContent).toContain("content");
  });
});
