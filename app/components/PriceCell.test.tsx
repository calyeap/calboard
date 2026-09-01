// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PriceCell } from "./PriceCell";

afterEach(() => {
  cleanup();
});

describe("PriceCell", () => {
  it("a current price renders plainly, with no marker and no title", () => {
    const { container } = render(
      <PriceCell priceStatus="current" priceUsd="199.99" priceDate="2026-08-26" />
    );
    expect(screen.getByText("$199.99")).toBeInTheDocument();
    expect(container.querySelector(".marker")).toBeNull();
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("a stale price shows the marker, the price, and the date only in the title tooltip", () => {
    const { container } = render(
      <PriceCell priceStatus="stale" priceUsd="199.99" priceDate="2026-07-01" />
    );
    expect(screen.getByText("$199.99")).toBeInTheDocument();
    expect(container.querySelector(".marker")).not.toBeNull();
    expect(container.querySelector('[title="Priced at 2026-07-01 close"]')).not.toBeNull();
    expect(screen.queryByText(/as of/i)).toBeNull();
  });

  it("an unavailable price shows the marker, an em dash, and 'No price available' in the title", () => {
    const { container } = render(
      <PriceCell priceStatus="unavailable" priceUsd={null} priceDate={null} />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(container.querySelector(".marker")).not.toBeNull();
    expect(container.querySelector('[title="No price available"]')).not.toBeNull();
  });

  it("renders no Retry control in any state", () => {
    const { rerender } = render(
      <PriceCell priceStatus="current" priceUsd="199.99" priceDate="2026-08-26" />
    );
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    rerender(<PriceCell priceStatus="stale" priceUsd="199.99" priceDate="2026-07-01" />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    rerender(<PriceCell priceStatus="unavailable" priceUsd={null} priceDate={null} />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});
