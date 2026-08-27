// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { retryPriceFetchAction } from "@/app/actions/prices";
import { PriceCell } from "./PriceCell";

// The Server Action's own behaviour is covered in app/actions/prices.test.ts;
// here it is exercised only to drive the cell's retry / retry-error states.
vi.mock("@/app/actions/prices", () => ({ retryPriceFetchAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const retryMock = vi.mocked(retryPriceFetchAction);

// Vitest isn't run with globals:true, so Testing Library's automatic
// afterEach(cleanup) isn't registered — unmount between tests explicitly.
afterEach(() => {
  cleanup();
});
beforeEach(() => {
  retryMock.mockReset();
});

describe("PriceCell", () => {
  it("a stale price stays legible — it shows the price, its date and a Retry control", () => {
    render(
      <PriceCell
        assetId="1"
        symbol="AAPL"
        assetClass="equity"
        priceStatus="stale"
        priceUsd="199.99"
        priceDate="2026-07-01"
      />
    );
    expect(screen.getByText(/\$199\.99/)).toBeInTheDocument();
    expect(screen.getByText(/as of 2026-07-01/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("an unavailable price reads 'No price yet' with a Retry control", () => {
    render(
      <PriceCell
        assetId="1"
        symbol="AAPL"
        assetClass="equity"
        priceStatus="unavailable"
        priceUsd={null}
        priceDate={null}
      />
    );
    expect(screen.getByText(/no price yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("a failed Retry announces the reason as an alert", async () => {
    retryMock.mockResolvedValue({ ok: false, message: "Price fetch failed." });
    render(
      <PriceCell
        assetId="1"
        symbol="AAPL"
        assetClass="equity"
        priceStatus="stale"
        priceUsd="199.99"
        priceDate="2026-07-01"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/price fetch failed/i);
  });
});
