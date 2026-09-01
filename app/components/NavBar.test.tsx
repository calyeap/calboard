// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PrivacyProvider, usePrivacy } from "./PrivacyContext";
import { NavBar } from "./NavBar";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
});

function HiddenProbe() {
  const { hidden } = usePrivacy();
  return <span data-testid="hidden">{String(hidden)}</span>;
}

describe("NavBar privacy toggle", () => {
  it("clicking the toggle flips the shared privacy state for other consumers under the same provider", () => {
    render(
      <PrivacyProvider>
        <NavBar />
        <HiddenProbe />
      </PrivacyProvider>
    );

    expect(screen.getByTestId("hidden").textContent).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /hide values/i }));

    expect(screen.getByTestId("hidden").textContent).toBe("true");
  });

  it("label reflects the current state so the control communicates what clicking it will do", () => {
    render(
      <PrivacyProvider>
        <NavBar />
      </PrivacyProvider>
    );

    const button = screen.getByRole("button", { name: /hide values/i });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: /show values/i })).toBeInTheDocument();
  });
});
