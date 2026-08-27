// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { localTodayIso } from "@/lib/dateValidation";
import { resolveTickerAction } from "@/app/actions/setup";
import { updateHoldingsAction } from "@/app/actions/holdings";
import { HoldingsEditor, type EditorInitialRow } from "./HoldingsEditor";

// The Server Actions are exercised through the component; their own DB-backed
// behaviour lives in app/actions/*.test.ts.
vi.mock("@/app/actions/setup", () => ({ resolveTickerAction: vi.fn() }));
vi.mock("@/app/actions/holdings", () => ({ updateHoldingsAction: vi.fn() }));
const resolveTickerActionMock = vi.mocked(resolveTickerAction);
const updateHoldingsActionMock = vi.mocked(updateHoldingsAction);

// Vitest isn't run with globals:true, so Testing Library's automatic
// afterEach(cleanup) isn't registered — unmount between tests explicitly.
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  resolveTickerActionMock.mockReset();
  updateHoldingsActionMock.mockReset();
});

const baseInitial = (): EditorInitialRow[] => [
  {
    assetId: "1",
    symbol: "AAPL",
    assetClass: "equity",
    quantity: "10",
    avgCostUsd: "150",
    priceUsd: "200.00",
    priceStatus: "current",
    marketValueUsd: "2000.00",
    unrealisedPlUsd: "500.00",
  },
  {
    assetId: "2",
    symbol: "MSFT",
    assetClass: "equity",
    quantity: "4",
    avgCostUsd: "300",
    priceUsd: "310.00",
    priceStatus: "current",
    marketValueUsd: "1240.00",
    unrealisedPlUsd: "40.00",
  },
];

describe("HoldingsEditor", () => {
  it("pre-fills an editable row per current holding with its quantity and average cost", () => {
    render(<HoldingsEditor initial={baseInitial()} />);
    expect((screen.getByLabelText("Quantity for AAPL") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Average cost for AAPL") as HTMLInputElement).value).toBe("150");
    expect((screen.getByLabelText("Quantity for MSFT") as HTMLInputElement).value).toBe("4");
    // As-of date is secondary — shown as text, no date input until "Change date".
    expect(screen.getByText(new RegExp(`as of ${localTodayIso()}`, "i"))).toBeInTheDocument();
    expect(screen.queryByLabelText("As-of date")).toBeNull();
  });

  it("shows a non-blocking note when a quantity is increased but its average cost is untouched", () => {
    render(<HoldingsEditor initial={baseInitial()} />);
    fireEvent.change(screen.getByLabelText("Quantity for AAPL"), { target: { value: "25" } });
    expect(
      screen.getByText(/your existing average cost is \$150\.00\. update it if your real average cost changed/i)
    ).toBeInTheDocument();
    // It never blocks Save.
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  it("a rejected submit shows the field error and keeps the entered quantity", async () => {
    updateHoldingsActionMock.mockResolvedValue({
      ok: false,
      errors: { "holdings.0.quantity": "Quantity must be zero or greater." },
    });
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.change(screen.getByLabelText("Quantity for AAPL"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText(/quantity must be zero or greater/i)).toBeInTheDocument()
    );
    expect((screen.getByLabelText("Quantity for AAPL") as HTMLInputElement).value).toBe("-5");
  });

  it("Save is disabled while a request is in flight and fires exactly once", async () => {
    let resolveSave: (v: { ok: true }) => void = () => {};
    updateHoldingsActionMock.mockImplementation(
      () => new Promise((res) => { resolveSave = res; })
    );
    render(<HoldingsEditor initial={baseInitial()} />);

    const saveButton = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton); // ignored

    await waitFor(() => expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled());

    resolveSave({ ok: true });
    await waitFor(() => expect(screen.getByText(/holdings updated/i)).toBeInTheDocument());
    expect(updateHoldingsActionMock).toHaveBeenCalledTimes(1);
  });

  it("the add-a-holding path blocks Add when the ticker was edited after resolution without re-resolving", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: true,
      assetId: "9",
      assetClass: "equity",
      priceUsd: "12.00",
      priceDate: "2026-08-25",
    });
    render(<HoldingsEditor initial={baseInitial()} />);

    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "TSLA" } });
    fireEvent.blur(ticker);
    await waitFor(() => expect(screen.getByText(/resolved/i)).toBeInTheDocument());

    fireEvent.change(ticker, { target: { value: "NVDA" } });
    expect(screen.queryByText(/resolved/i)).toBeNull(); // resolution cleared

    fireEvent.change(screen.getByLabelText("New holding quantity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("New holding average cost"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /add holding/i }));

    expect(screen.getByText(/resolve the ticker first/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Quantity for NVDA")).toBeNull();
  });

  it("a rejected action call surfaces the 'couldn't reach the server' copy and re-enables Save", async () => {
    updateHoldingsActionMock.mockRejectedValue(new Error("network down"));
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText(/couldn't reach the server/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/nothing was saved/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  it("an uncertain commit shows the 'couldn't confirm' copy and never the 'nothing was saved' copy", async () => {
    updateHoldingsActionMock.mockResolvedValue({
      ok: "unknown",
      message: "We couldn't confirm whether this saved — check the Dashboard before trying again.",
    });
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText(/couldn't confirm whether this saved/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/nothing was saved/i)).toBeNull();
  });

  it("removing a holding submits it at quantity 0 without cash or transaction wording", async () => {
    updateHoldingsActionMock.mockResolvedValue({ ok: true });
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.click(screen.getByRole("button", { name: /remove msft/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(updateHoldingsActionMock).toHaveBeenCalledTimes(1));
    const arg = updateHoldingsActionMock.mock.calls[0][0];
    const msft = arg.holdings.find((h) => h.assetId === "2");
    expect(msft?.quantity).toBe("0");
    // No cash / transaction terminology anywhere in the editor.
    expect(screen.queryByText(/deposit|withdrawal|\bcash\b|transaction|buy\b|sell\b/i)).toBeNull();
  });
});
