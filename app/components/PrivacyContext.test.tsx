// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PrivacyProvider, usePrivacy } from "./PrivacyContext";

afterEach(() => {
  cleanup();
});

function Probe() {
  const { hidden, toggle } = usePrivacy();
  return (
    <>
      <span data-testid="hidden">{String(hidden)}</span>
      <button type="button" onClick={toggle}>
        toggle
      </button>
    </>
  );
}

describe("usePrivacy", () => {
  it("without a provider, defaults to not-hidden and a no-op toggle", () => {
    render(<Probe />);
    expect(screen.getByTestId("hidden").textContent).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("hidden").textContent).toBe("false");
  });

  it("inside a PrivacyProvider, toggle flips hidden state", () => {
    render(
      <PrivacyProvider>
        <Probe />
      </PrivacyProvider>
    );
    expect(screen.getByTestId("hidden").textContent).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("hidden").textContent).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("hidden").textContent).toBe("false");
  });

  it("state is shared across every consumer under the same provider", () => {
    render(
      <PrivacyProvider>
        <Probe />
        <Probe />
      </PrivacyProvider>
    );
    const toggles = screen.getAllByRole("button", { name: "toggle" });
    fireEvent.click(toggles[0]);
    const hiddenSpans = screen.getAllByTestId("hidden");
    expect(hiddenSpans[0].textContent).toBe("true");
    expect(hiddenSpans[1].textContent).toBe("true");
  });
});
