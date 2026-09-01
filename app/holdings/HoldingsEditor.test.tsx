// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { localTodayIso } from "@/lib/dateValidation";
import { resolveTickerAction } from "@/app/actions/setup";
import { updateHoldingsAction } from "@/app/actions/holdings";
import { HoldingsEditor, type EditorInitialRow } from "./HoldingsEditor";
import { PrivacyProvider, usePrivacy } from "@/app/components/PrivacyContext";

// The Server Actions are exercised through the component; their own DB-backed
// behaviour lives in app/actions/*.test.ts.
vi.mock("@/app/actions/setup", () => ({ resolveTickerAction: vi.fn() }));
vi.mock("@/app/actions/holdings", () => ({ updateHoldingsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

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
    expect((screen.getByLabelText("As-of date") as HTMLInputElement).value).toBe(localTodayIso());
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
    const { container } = render(<HoldingsEditor initial={initial} />);

    expect(container.querySelector('[title="Priced at 2026-07-01 close"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
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
    // (the Symbol cell now leads with a <span class="cell-label">Symbol</span>
    // narrow-width label — Task 30 fix round 2 — so read the trailing symbol
    // text node, not the whole cell's textContent)
    const symbolCells = Array.from(document.querySelectorAll("tbody tr td:first-child")).map(
      (c) => c.lastChild?.textContent
    );
    expect(symbolCells).toEqual(["AAPL", "MSFT", "NEW"]);
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

  // --- Task 29: status, feedback & accessibility ---

  it("T29-1: a row-only save rejection shows a fix-the-errors summary near Save (assertive), field errors still attached", async () => {
    updateHoldingsActionMock.mockResolvedValue({
      ok: false,
      errors: { "holdings.0.quantity": "Quantity must be zero or greater." },
    });
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.change(screen.getByLabelText("Quantity for AAPL"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const summary = await screen.findByText(/fix the highlighted errors before saving/i);
    expect(summary).toHaveAttribute("role", "alert");
    // near the Save control, not buried inside the table, and above the button
    expect(summary.closest("table")).toBeNull();
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(summary.compareDocumentPosition(saveBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // the row-level message stays attached to its field
    const qty = screen.getByLabelText("Quantity for AAPL");
    expect(qty).toHaveAttribute("aria-invalid", "true");
    const ids = (qty.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    expect(ids.map((x) => document.getElementById(x)?.textContent).join(" ")).toMatch(
      /quantity must be zero or greater/i
    );
  });

  it("T29-2: no fix-the-errors summary when the rejection carries a form-level message instead", async () => {
    updateHoldingsActionMock.mockResolvedValue({
      ok: false,
      errors: { form: "We couldn't find your portfolio to update." },
    });
    render(<HoldingsEditor initial={baseInitial()} />);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText(/couldn't find your portfolio/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/fix the highlighted errors before saving/i)).toBeNull();
  });

  it("T29-3: a resolved ticker result is announced in a polite live region", async () => {
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

    const msg = await screen.findByText(/resolved — last price \$12\.00/i);
    const live = msg.closest("[aria-live]");
    expect(live).not.toBeNull();
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(msg.closest('[role="alert"]')).toBeNull();
  });

  it("T29-4: a not-found ticker result is announced in the same polite live region", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: false,
      assetId: "9",
      message:
        'Couldn\'t find a price for "TSLA". Check the symbol, or add it anyway if you\'re sure it\'s correct.',
    });
    render(<HoldingsEditor initial={baseInitial()} />);
    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "TSLA" } });
    fireEvent.blur(ticker);

    const msg = await screen.findByText(/couldn't find a price for "TSLA"/i);
    const live = msg.closest("[aria-live]");
    expect(live).not.toBeNull();
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(msg.closest('[role="alert"]')).toBeNull();
  });

  it("T29-5: an as-of-date-only rejection (no row error, no form error) still shows the summary near Save", () => {
    render(<HoldingsEditor initial={baseInitial()} />);
    fireEvent.change(screen.getByLabelText("As-of date"), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const summary = screen.getByText(/fix the highlighted errors before saving/i);
    expect(summary).toHaveAttribute("role", "alert");
    expect(summary.closest("table")).toBeNull();
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(summary.compareDocumentPosition(saveBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // the date error itself is unchanged — still associated with the input
    const input = screen.getByLabelText("As-of date");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const id = input.getAttribute("aria-describedby");
    expect(document.getElementById(id!)?.textContent).toMatch(/future/i);
  });

  // --- Task 30: responsive presentation ---

  it("T30-1: each holding row's value cells carry a narrow-width field label as real DOM text", () => {
    render(<HoldingsEditor initial={baseInitial()} />);
    const tr = screen.getByLabelText("Quantity for AAPL").closest("tr")!;
    const labels = Array.from(tr.querySelectorAll("td")).map(
      (td) => td.querySelector(".cell-label")?.textContent ?? null
    );
    expect(labels).toEqual([
      "Symbol",
      "Type",
      "Quantity",
      "Average cost",
      "Price",
      "Market value",
      "Unrealised P&L",
      null,
    ]);
  });

  it("T30-2: the editor table is wrapped in the responsive container", () => {
    render(<HoldingsEditor initial={baseInitial()} />);
    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("editor-table");
  });

  it("T30-3: each editable control and row action is rendered exactly once (no duplicated narrow-width variant)", () => {
    render(<HoldingsEditor initial={baseInitial()} />);
    expect(screen.getAllByLabelText("Quantity for AAPL")).toHaveLength(1);
    expect(screen.getAllByLabelText("Average cost for AAPL")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /remove aapl/i })).toHaveLength(1);
  });

  it("T30-4: the read-only Price / Market value / Unrealised P&L cells label their value with real DOM text (not only CSS ::before)", () => {
    render(<HoldingsEditor initial={baseInitial()} />);
    const tds = Array.from(
      screen.getByLabelText("Quantity for AAPL").closest("tr")!.querySelectorAll("td")
    );
    const [priceTd, mvTd, plTd] = [tds[4], tds[5], tds[6]];
    expect(priceTd.querySelector(".cell-label")?.textContent).toBe("Price");
    expect(mvTd.querySelector(".cell-label")?.textContent).toBe("Market value");
    expect(plTd.querySelector(".cell-label")?.textContent).toBe("Unrealised P&L");
    expect(priceTd.querySelector(".cell-label")?.tagName).toBe("SPAN");
    // label precedes the value in DOM/reading order
    expect(mvTd.firstElementChild?.classList.contains("cell-label")).toBe(true);
  });

  it("T30-5: existing accessible input/button names are unchanged by the responsive field labels", () => {
    render(<HoldingsEditor initial={baseInitial()} />);
    expect(screen.getByLabelText("Quantity for AAPL")).toBeInTheDocument();
    expect(screen.getByLabelText("Average cost for AAPL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove AAPL" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Quantity for AAPL")).toHaveLength(1);
  });

  // --- M1.1 BTC live regression: Crypto selected BEFORE the ticker is typed ---

  it("BTC-1: selecting Crypto then typing BTC resolves as (BTC, crypto) — never the bare-ticker equity path", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: true,
      assetId: "btc",
      assetClass: "crypto",
      priceUsd: "80000.00",
      priceDate: "2026-08-28",
    });
    render(<HoldingsEditor initial={baseInitial()} />);

    // 1. select Crypto BEFORE typing anything
    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "crypto" } });
    // 2. type BTC
    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "BTC" } });
    // 3. resolution fires
    fireEvent.blur(ticker);

    await waitFor(() => expect(resolveTickerActionMock).toHaveBeenCalled());
    // every resolution attempt for BTC must carry assetClass "crypto"
    for (const call of resolveTickerActionMock.mock.calls) {
      expect(call).toEqual(["BTC", "crypto"]);
    }
    expect(resolveTickerActionMock).toHaveBeenCalledWith("BTC", "crypto");
    expect(resolveTickerActionMock).not.toHaveBeenCalledWith("BTC", "equity");
  });

  // --- M1 identity-resolution defect fix: the override path is gone -------

  it("renders no 'Add anyway' control, even when a ticker fails to resolve", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: false,
      assetId: null,
      message: 'Couldn\'t find "DSADASD". Check the symbol and try again.',
    });
    render(<HoldingsEditor initial={baseInitial()} />);

    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "DSADASD" } });
    fireEvent.blur(ticker);

    await waitFor(() => expect(screen.getByText(/couldn't find "dsadasd"/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /add anyway/i })).toBeNull();
  });

  it("a resolved-but-price-unavailable identity can still be added via the normal Add button (no override needed)", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: false,
      assetId: "9",
      message: "Identity confirmed for \"NEWCO\", but its live price is unavailable right now.",
    });
    render(<HoldingsEditor initial={baseInitial()} />);

    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "NEWCO" } });
    fireEvent.blur(ticker);
    await waitFor(() => expect(screen.getByText(/price is unavailable/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /add anyway/i })).toBeNull();

    fireEvent.change(screen.getByLabelText("New holding quantity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("New holding average cost"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /^\+ add holding$/i }));

    expect(screen.getByLabelText("Quantity for NEWCO")).toBeInTheDocument();
  });

  it("BTC-2: switching away from Crypto after a BTC resolve invalidates it; a late crypto response cannot resurrect it", async () => {
    let resolveCrypto: (v: any) => void = () => {};
    resolveTickerActionMock
      .mockImplementationOnce(() => new Promise((res) => { resolveCrypto = res; }))
      .mockImplementationOnce(async () => ({
        ok: false,
        assetId: null,
        message: 'Couldn\'t find a price for "BTC". Check the symbol, or add it anyway if you\'re sure it\'s correct.',
      }));
    render(<HoldingsEditor initial={baseInitial()} />);

    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "crypto" } });
    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "BTC" } });
    fireEvent.blur(ticker); // call 1 (crypto) — pending

    // user switches to Equity before the crypto resolve lands
    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "equity" } });
    await waitFor(() => expect(resolveTickerActionMock).toHaveBeenLastCalledWith("BTC", "equity"));

    // the late crypto ok-result must not overwrite the current (equity) state
    resolveCrypto({ ok: true, assetId: "btc", assetClass: "crypto", priceUsd: "80000.00", priceDate: "2026-08-28" });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText(/last price \$80000\.00/i)).toBeNull();
  });
});

describe("HoldingsEditor — M1.5: asset type display", () => {
  it("each row shows its stored asset type — sourced from assetClass, not inferred from the ticker", () => {
    render(
      <HoldingsEditor
        initial={[
          row({ assetId: "1", symbol: "NVDA", assetClass: "equity" }),
          row({ assetId: "2", symbol: "VOO", assetClass: "etf" }),
          row({ assetId: "3", symbol: "BTC", assetClass: "crypto" }),
        ]}
      />
    );

    const rows = screen.getAllByRole("row").slice(1); // skip header
    expect(rows[0].textContent).toContain("Equity");
    expect(rows[1].textContent).toContain("ETF");
    expect(rows[2].textContent).toContain("Crypto");
  });
});

describe("HoldingsEditor — M1.5: privacy toggle", () => {
  function ToggleButton() {
    const { toggle } = usePrivacy();
    return (
      <button type="button" onClick={toggle}>
        toggle
      </button>
    );
  }

  it("masks the editable Quantity and Average cost inputs (still editable) without hiding Price", () => {
    render(
      <PrivacyProvider>
        <ToggleButton />
        <HoldingsEditor initial={baseInitial()} />
      </PrivacyProvider>
    );

    const qty = screen.getByLabelText("Quantity for AAPL") as HTMLInputElement;
    const avg = screen.getByLabelText("Average cost for AAPL") as HTMLInputElement;
    expect(qty.type).toBe("text");
    expect(avg.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(qty.type).toBe("password");
    expect(avg.type).toBe("password");
    expect(qty.value).toBe("10"); // value unchanged — still fully editable
    fireEvent.change(qty, { target: { value: "25" } });
    expect(qty.value).toBe("25");

    // Price is never masked.
    expect(screen.getByText(/\$200\.00/)).toBeInTheDocument();
  });

  it("masks the derived Market value and Unrealised P&L cells", () => {
    render(
      <PrivacyProvider>
        <ToggleButton />
        <HoldingsEditor initial={baseInitial()} />
      </PrivacyProvider>
    );

    // Unhidden: AAPL market value = 10 * 200.00 = 2000.00
    expect(screen.getByText("2000.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.queryByText("2000.00")).toBeNull();
    expect(screen.getAllByText(/•/).length).toBeGreaterThan(0);
  });

  it("masks the Add-a-holding draft Quantity and Average cost inputs too", () => {
    render(
      <PrivacyProvider>
        <ToggleButton />
        <HoldingsEditor initial={baseInitial()} />
      </PrivacyProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect((screen.getByLabelText("New holding quantity") as HTMLInputElement).type).toBe("password");
    expect((screen.getByLabelText("New holding average cost") as HTMLInputElement).type).toBe("password");
  });
});
