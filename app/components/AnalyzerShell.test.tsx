// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ThemeProvider } from "./ThemeContext";
import { AnalyzerShell } from "./AnalyzerShell";

afterEach(cleanup);

describe("AnalyzerShell", () => {
  it("renders the .cb-analyzer wrapper with data-theme matching the current theme", () => {
    const { container } = render(
      <ThemeProvider>
        <AnalyzerShell>
          <p>content</p>
        </AnalyzerShell>
      </ThemeProvider>
    );
    const wrapper = container.querySelector(".cb-analyzer")!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.getAttribute("data-theme")).toBe("light");
    expect(wrapper.textContent).toContain("content");
  });
});
