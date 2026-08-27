// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { localTodayIso } from "@/lib/dateValidation";
import { resolveTickerAction } from "@/app/actions/setup";
import { updateHoldingsAction } from "@/app/actions/holdings";
import { retryPriceFetchAction } from "@/app/actions/prices";
import { HoldingsEditor, type EditorInitialRow } from "./HoldingsEditor";

// The Server Actions are exercised through the component; their own DB-backed
// behaviour lives in app/actions/*.test.ts.
vi.mock("@/app/actions/setup", () => ({ resolveTickerAction: vi.fn() }));
vi.mock("@/app/actions/holdings", () => ({ updateHoldingsAction: vi.fn() }));
// PriceCell (reused for price-health display) pulls in these.
vi.mock("@/app/actions/prices", () => ({ retryPriceFetchAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const resolveTickerActionMock = vi.mocked(resolveTickerAction);
const updateHoldingsActionMock = vi.mocked(updateHoldingsAction);
const retryPriceFetchActionMock = vi.mocked(retryPriceFetchAction);

// Vitest isn't run with globals:true, so Testing Library's automatic
// afterEach(cleanup) isn't registered — unmount between tests explicitly.
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  resolveTickerActionMock.mockReset();
  updateHoldingsActionMock.mockReset();
  retryPriceFetchActionMock.mockReset();
});

const row = (over: Partial<EditorInitialRow> & Pick<EditorInitialRow, "assetId" | "symbol">): EditorInitialRow => ({
  assetClass: "equity",
  quantity: "10",
  avgCostUsd: "150",
  priceUsd: "200.00",
  priceStatus: "current",
  priceDate: "2026-08-26",
  ...over,
});

const baseInitial = (): EditorInitialRow[] => [
  row({ assetId: "1", symbol: "AAPL", quantity: "10", avgCostUsd: "150", priceUsd: "200.00" }),
  row({ assetId: "2", symbol: "MSFT", quantity: "4", avgCostUsd: "300", priceUsd: "310.00" }),
];

describe("HoldingsEditor", () => {
  it("pre-fills an editable row per current holding with its quantity and average cost", () => {
    render(<HoldingsEditor initial={baseInitial()} />);
    expect((screen.getByLabelText("Quantity for AAPL") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Average cost for AAPL") as HTMLInputElement).value).toBe("150");
    expect((screen.getByLabelText("Quantity for MSFT") as HTMLInputElement).value).toBe("4");
    expect(screen.getByText(new RegExp(`as of ${localTodayIso()}`, "i"))).toBeInTheDocument();
    expect(screen.queryByLabelText("As-of date")).toBeNull();
  });

  it("shows a non-blocking note when a quantity is increased but its average cost is untouched", () => {
    render(<HoldingsEditor initial={baseInitial()} />);
    fireEvent.change(screen.getByLabelText("Quantity for AAPL"), { target: { value: "25" } });
    expect(
      screen.getByText(/your existing average cost is \$150\.00\. update it if your real average cost changed/i)
    ).toBeInTheDocument();
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
    expect(screen.queryByText(/resolved/i)).toBeNull();

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

    await waitFor(() => expect(screen.getByText(/couldn't reach the server/i)).toBeInTheDocument());
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
    expect(screen.queryByText(/deposit|withdrawal|\bcash\b|transaction|buy\b|sell\b/i)).toBeNull();
  });

  // --- Task 25A required corrections ---

  it("A: a no-op Save submits the exact baseline holdings payload", async () => {
    updateHoldingsActionMock.mockResolvedValue({ ok: true });
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(updateHoldingsActionMock).toHaveBeenCalledTimes(1));

    expect(updateHoldingsActionMock.mock.calls[0][0]).toEqual({
      asOfDate: localTodayIso(),
      holdings: [
        { assetId: "1", quantity: "10", avgCostUsd: "150" },
        { assetId: "2", quantity: "4", avgCostUsd: "300" },
      ],
    });
  });

  it("B: a successful Save rebases rows — note clears, removed & manually-zeroed rows disappear, derived figures match, a second Save submits the rebased state", async () => {
    updateHoldingsActionMock.mockResolvedValue({ ok: true });
    const initial: EditorInitialRow[] = [
      row({ assetId: "1", symbol: "AAPL", quantity: "10", avgCostUsd: "150", priceUsd: "200.00" }),
      row({ assetId: "2", symbol: "MSFT", quantity: "4", avgCostUsd: "300", priceUsd: "310.00" }),
      row({ assetId: "3", symbol: "CCC", quantity: "5", avgCostUsd: "10", priceUsd: "12.00" }),
    ];
    render(<HoldingsEditor initial={initial} />);

    fireEvent.change(screen.getByLabelText("Quantity for AAPL"), { target: { value: "20" } });
    expect(screen.getByText(/your existing average cost is \$150\.00/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove msft/i }));
    fireEvent.change(screen.getByLabelText("Quantity for CCC"), { target: { value: "0" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(screen.getByText(/holdings updated/i)).toBeInTheDocument());

    expect(screen.queryByText(/your existing average cost is/i)).toBeNull();
    expect(screen.queryByLabelText("Quantity for MSFT")).toBeNull();
    expect(screen.queryByLabelText("Quantity for CCC")).toBeNull();
    // AAPL derived: MV = 20 * 200 = 4000.00 ; P&L = (200 - 150) * 20 = 1000.00
    expect(screen.getByText("4000.00")).toBeInTheDocument();
    expect(screen.getByText("1000.00")).toBeInTheDocument();

    updateHoldingsActionMock.mockClear();
    updateHoldingsActionMock.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(updateHoldingsActionMock).toHaveBeenCalledTimes(1));
    expect(updateHoldingsActionMock.mock.calls[0][0].holdings).toEqual([
      { assetId: "1", quantity: "20", avgCostUsd: "150" },
    ]);
  });

  it("C: field errors render under the correct row and clear after a structural change", async () => {
    updateHoldingsActionMock.mockResolvedValue({
      ok: false,
      errors: { "holdings.1.quantity": "Quantity must be zero or greater." },
    });
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(screen.getByText(/quantity must be zero or greater/i)).toBeInTheDocument()
    );

    const msftQty = screen.getByLabelText("Quantity for MSFT");
    const describedBy = msftQty.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!.split(/\s+/)[0])?.textContent).toMatch(
      /quantity must be zero or greater/i
    );
    expect(screen.getByLabelText("Quantity for AAPL").getAttribute("aria-invalid")).not.toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /remove aapl/i }));
    expect(screen.queryByText(/quantity must be zero or greater/i)).toBeNull();
  });

  it("D: a removed row with an invalid live average cost still submits quantity 0 with its valid initial average cost", async () => {
    updateHoldingsActionMock.mockResolvedValue({ ok: true });
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.change(screen.getByLabelText("Average cost for MSFT"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /remove msft/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(updateHoldingsActionMock).toHaveBeenCalledTimes(1));
    const msft = updateHoldingsActionMock.mock.calls[0][0].holdings.find((h) => h.assetId === "2");
    expect(msft).toEqual({ assetId: "2", quantity: "0", avgCostUsd: "300" });
  });

  it("E: a stale price is visibly distinct from a current one", () => {
    const initial: EditorInitialRow[] = [
      row({ assetId: "1", symbol: "AAPL", priceUsd: "199.99", priceStatus: "stale", priceDate: "2026-07-01" }),
      row({ assetId: "2", symbol: "MSFT", priceUsd: "310.00", priceStatus: "current", priceDate: "2026-08-26" }),
    ];
    render(<HoldingsEditor initial={initial} />);

    expect(screen.getByText(/as of 2026-07-01/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /retry/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("$310.00")).toBeInTheDocument();
  });

  it("F: changing asset type with a populated ticker re-resolves with the new type", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: true,
      assetId: "9",
      assetClass: "etf",
      priceUsd: "50.00",
      priceDate: "2026-08-25",
    });
    render(<HoldingsEditor initial={baseInitial()} />);

    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "SOFI" } });
    fireEvent.blur(ticker);
    await waitFor(() => expect(resolveTickerActionMock).toHaveBeenCalledWith("SOFI", "equity"));

    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "etf" } });
    await waitFor(() => expect(resolveTickerActionMock).toHaveBeenCalledWith("SOFI", "etf"));
    await waitFor(() => expect(screen.getByText(/resolved/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("New holding quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("New holding average cost"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /add holding/i }));
    expect(screen.getByLabelText("Quantity for SOFI")).toBeInTheDocument();
  });

  it("G: a late older resolution response cannot overwrite the newer ticker/asset-type selection", async () => {
    let resolveOld: (v: any) => void = () => {};
    resolveTickerActionMock
      .mockImplementationOnce(() => new Promise((res) => { resolveOld = res; }))
      .mockImplementationOnce(async () => ({
        ok: true,
        assetId: "NEW",
        assetClass: "etf",
        priceUsd: "77.00",
        priceDate: "2026-08-25",
      }));
    updateHoldingsActionMock.mockResolvedValue({ ok: true });

    render(<HoldingsEditor initial={baseInitial()} />);
    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "AAA" } });
    fireEvent.blur(ticker); // call 1 (equity) — pending

    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "etf" } }); // call 2 — resolves now
    await waitFor(() => expect(screen.getByText(/last price \$77\.00/i)).toBeInTheDocument());

    resolveOld({ ok: true, assetId: "OLD", assetClass: "equity", priceUsd: "11.00", priceDate: "2026-08-25" });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText(/last price \$11\.00/i)).toBeNull();
    expect(screen.getByText(/last price \$77\.00/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New holding quantity"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("New holding average cost"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: /add holding/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(updateHoldingsActionMock).toHaveBeenCalledTimes(1));

    const submitted = updateHoldingsActionMock.mock.calls[0][0].holdings;
    expect(submitted.find((h) => h.assetId === "NEW")).toBeTruthy();
    expect(submitted.find((h) => h.assetId === "OLD")).toBeUndefined();
  });

  it("H: per-field validation messages are programmatically associated with their inputs", async () => {
    updateHoldingsActionMock.mockResolvedValue({
      ok: false,
      errors: { "holdings.0.avgCostUsd": "Average cost must be greater than zero." },
    });
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(screen.getByText(/average cost must be greater than zero/i)).toBeInTheDocument()
    );

    const avg = screen.getByLabelText("Average cost for AAPL");
    expect(avg.getAttribute("aria-invalid")).toBe("true");
    const ids = (avg.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    const combined = ids.map((x) => document.getElementById(x)?.textContent || "").join(" ");
    expect(combined).toMatch(/average cost must be greater than zero/i);
    expect(document.getElementById(ids[0])?.getAttribute("role")).toBe("alert");
  });

  it("N1: refreshed price metadata syncs into existing rows without discarding unsaved edits, removal state, new rows or order", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: true,
      assetId: "9",
      assetClass: "equity",
      priceUsd: "12.00",
      priceDate: "2026-08-25",
    });
    const unavailable: EditorInitialRow[] = [
      row({ assetId: "1", symbol: "AAPL", quantity: "10", avgCostUsd: "150", priceUsd: null, priceStatus: "unavailable", priceDate: null }),
      row({ assetId: "2", symbol: "MSFT", quantity: "4", avgCostUsd: "300", priceUsd: "310.00", priceStatus: "current", priceDate: "2026-08-26" }),
    ];
    const { rerender } = render(<HoldingsEditor initial={unavailable} />);

    // unsaved edits to the still-unpriced row
    fireEvent.change(screen.getByLabelText("Quantity for AAPL"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Average cost for AAPL"), { target: { value: "160" } });
    // mark an existing row removed
    fireEvent.click(screen.getByRole("button", { name: /remove msft/i }));
    // add a brand-new row
    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "NEW" } });
    fireEvent.blur(ticker);
    await waitFor(() => expect(screen.getByText(/resolved/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("New holding quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("New holding average cost"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /add holding/i }));
    await waitFor(() => expect(screen.getByLabelText("Quantity for NEW")).toBeInTheDocument());

    // the RSC refreshes (Retry -> router.refresh) and hands back updated
    // price metadata for the original asset via a NEW initial array
    const refreshed: EditorInitialRow[] = [
      row({ assetId: "1", symbol: "AAPL", quantity: "10", avgCostUsd: "150", priceUsd: "205.00", priceStatus: "current", priceDate: "2026-08-27" }),
      row({ assetId: "2", symbol: "MSFT", quantity: "4", avgCostUsd: "300", priceUsd: "310.00", priceStatus: "current", priceDate: "2026-08-26" }),
    ];
    rerender(<HoldingsEditor initial={refreshed} />);

    // updated price is now visible on the AAPL row and its derived figures
    // use the LIVE edited quantity/avg cost: MV = 30 * 205 = 6150.00,
    // P&L = (205 - 160) * 30 = 1350.00
    await waitFor(() => expect(screen.getByText("$205.00")).toBeInTheDocument());
    expect(screen.getByText("6150.00")).toBeInTheDocument();
    expect(screen.getByText("1350.00")).toBeInTheDocument();

    // every piece of unsaved client state survived
    expect((screen.getByLabelText("Quantity for AAPL") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("Average cost for AAPL") as HTMLInputElement).value).toBe("160");
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument(); // MSFT still removed
    expect((screen.getByLabelText("Quantity for MSFT") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByLabelText("Quantity for NEW")).toBeInTheDocument(); // new row untouched

    // row order preserved: AAPL, MSFT, NEW
    const symbolCells = Array.from(document.querySelectorAll("tbody tr td:first-child")).map(
      (c) => c.textContent
    );
    expect(symbolCells).toEqual(["AAPL", "MSFT", "NEW"]);
  });

  it("N1b: PriceCell Retry calls retryPriceFetchAction with the row's assetId, symbol and assetClass", async () => {
    retryPriceFetchActionMock.mockResolvedValue({ ok: true });
    const initial: EditorInitialRow[] = [
      row({ assetId: "42", symbol: "TSLA", assetClass: "equity", priceUsd: "100.00", priceStatus: "stale", priceDate: "2026-07-01" }),
    ];
    render(<HoldingsEditor initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(retryPriceFetchActionMock).toHaveBeenCalledTimes(1));
    expect(retryPriceFetchActionMock).toHaveBeenCalledWith("42", "TSLA", "equity");
  });

  it("N2: the 'checking…' status clears when a pending resolution is invalidated by editing the ticker", async () => {
    resolveTickerActionMock.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<HoldingsEditor initial={baseInitial()} />);

    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "AAA" } });
    fireEvent.blur(ticker);
    await waitFor(() => expect(screen.getByText(/checking/i)).toBeInTheDocument());

    // Editing the ticker invalidates the in-flight request without starting
    // a new one — the status must not stay stuck.
    fireEvent.change(ticker, { target: { value: "AAB" } });
    expect(screen.queryByText(/checking/i)).toBeNull();
  });

  it("N4: the as-of-date error is programmatically associated with the date input", () => {
    render(<HoldingsEditor initial={baseInitial()} />);
    fireEvent.click(screen.getByRole("button", { name: /change date/i }));
    fireEvent.change(screen.getByLabelText("As-of date"), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const input = screen.getByLabelText("As-of date");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const id = input.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toMatch(/future/i);
  });

  it("N5: an uncertain-commit warning persists across an unrelated field edit", async () => {
    updateHoldingsActionMock.mockResolvedValue({
      ok: "unknown",
      message: "We couldn't confirm whether this saved — check the Dashboard before trying again.",
    });
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(screen.getByText(/couldn't confirm whether this saved/i)).toBeInTheDocument()
    );

    fireEvent.change(screen.getByLabelText("Quantity for AAPL"), { target: { value: "11" } });
    expect(screen.getByText(/couldn't confirm whether this saved/i)).toBeInTheDocument();
  });

  it("N5b: a 'Holdings updated' confirmation still clears once the user edits again", async () => {
    updateHoldingsActionMock.mockResolvedValue({ ok: true });
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(screen.getByText(/holdings updated/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Quantity for AAPL"), { target: { value: "11" } });
    expect(screen.queryByText(/holdings updated/i)).toBeNull();
  });
});
