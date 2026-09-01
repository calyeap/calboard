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

  it("masks by replacing each digit with a bullet, preserving length and punctuation (no column-width shift)", () => {
    render(
      <PrivacyProvider>
        <ToggleButton />
        <MaskableValue>1234.56</MaskableValue>
      </PrivacyProvider>
    );
    expect(screen.getByText("1234.56")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.queryByText("1234.56")).toBeNull();
    const masked = screen.getByText("••••.••");
    expect(masked).toBeInTheDocument();
    expect(masked.textContent).toHaveLength("1234.56".length);
  });

  it("masks a negative/thousands-separated value digit-for-digit, keeping the sign and separators", () => {
    render(
      <PrivacyProvider>
        <ToggleButton />
        <MaskableValue>-12,345.60</MaskableValue>
      </PrivacyProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByText("-••,•••.••")).toBeInTheDocument();
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
