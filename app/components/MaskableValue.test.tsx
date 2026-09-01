// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PrivacyProvider, usePrivacy } from "./PrivacyContext";
import { MaskableValue } from "./MaskableValue";

afterEach(() => {
  cleanup();
});

function ToggleButton() {
  const { toggle } = usePrivacy();
  return (
    <button type="button" onClick={toggle}>
      toggle
    </button>
  );
}

describe("MaskableValue", () => {
  it("renders its children when privacy is not hidden (the default, e.g. no provider)", () => {
    render(<MaskableValue>1234.56</MaskableValue>);
    expect(screen.getByText("1234.56")).toBeInTheDocument();
  });

  it("renders a placeholder instead of its children once privacy is toggled on", () => {
    render(
      <PrivacyProvider>
        <ToggleButton />
        <MaskableValue>1234.56</MaskableValue>
      </PrivacyProvider>
    );
    expect(screen.getByText("1234.56")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.queryByText("1234.56")).toBeNull();
    expect(screen.getByText("••••••")).toBeInTheDocument();
  });

  it("accepts a custom placeholder", () => {
    render(
      <PrivacyProvider>
        <ToggleButton />
        <MaskableValue placeholder="hidden">42</MaskableValue>
      </PrivacyProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByText("hidden")).toBeInTheDocument();
  });
});
