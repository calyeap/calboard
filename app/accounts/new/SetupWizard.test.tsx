// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { localTodayIso } from "@/lib/dateValidation";
import { resolveTickerAction, setupAccountAction } from "@/app/actions/setup";
import { SetupWizard } from "./SetupWizard";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// The Server Actions are exercised through the component; their own
// DB-backed behaviour is covered in app/actions/setup.test.ts.
vi.mock("@/app/actions/setup", () => ({
  resolveTickerAction: vi.fn(),
  setupAccountAction: vi.fn(),
}));
const resolveTickerActionMock = vi.mocked(resolveTickerAction);
const setupAccountActionMock = vi.mocked(setupAccountAction);

beforeEach(() => {
  pushMock.mockClear();
  resolveTickerActionMock.mockReset();
  setupAccountActionMock.mockReset();
});

// Vitest isn't run with globals:true, so @testing-library/react's automatic
// afterEach(cleanup) isn't registered — unmount between tests explicitly.
afterEach(() => {
  cleanup();
});

describe("SetupWizard — Step 1 (as-of date)", () => {
  it("mounts on Step 1 showing today's as-of date as a plain line, with no date input visible", () => {
    render(<SetupWizard />);

    expect(screen.getByRole("heading", { name: /add your holdings/i })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`current as of ${localTodayIso()}`, "i"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change date/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("As-of date")).toBeNull();
  });

  it("'Change date' reveals the date input", () => {
    render(<SetupWizard />);
    fireEvent.click(screen.getByRole("button", { name: /change date/i }));
    expect(screen.getByLabelText("As-of date")).toBeInTheDocument();
  });

  it("a future as-of date shows an inline error and keeps the user on Step 1", () => {
    render(<SetupWizard />);
    fireEvent.click(screen.getByRole("button", { name: /change date/i }));
    fireEvent.change(screen.getByLabelText("As-of date"), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /next: review/i }));

    expect(screen.getByText(/future/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /add your holdings/i })).toBeInTheDocument();
  });

  it("Cancel with an unchanged (today) date navigates to /holdings without a confirm prompt", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SetupWizard />);

    fireEvent.click(screen.getByRole("button", { name: /cancel setup/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/holdings");
    confirmSpy.mockRestore();
  });

  it("Cancel after changing the date prompts window.confirm before navigating", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SetupWizard />);

    fireEvent.click(screen.getByRole("button", { name: /change date/i }));
    fireEvent.change(screen.getByLabelText("As-of date"), { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel setup/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/holdings");
    confirmSpy.mockRestore();
  });
});

describe("SetupWizard — Step 1 holdings list", () => {
  const okResolution = (over: Partial<{ priceUsd: string; priceDate: string; assetId: string }> = {}) => ({
    ok: true as const,
    assetId: over.assetId ?? "1",
    assetClass: "equity" as const,
    priceUsd: over.priceUsd ?? "228.50",
    priceDate: over.priceDate ?? "2026-08-25",
  });

  // Only used in the default "average" mode.
  async function addHolding(ticker: string, qty: string, cost: string) {
    fireEvent.change(screen.getByLabelText("Ticker symbol"), { target: { value: ticker } });
    fireEvent.blur(screen.getByLabelText("Ticker symbol"));
    await waitFor(() => expect(screen.getByText(/resolved/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: qty } });
    fireEvent.change(screen.getByLabelText("Average cost per unit (USD)"), { target: { value: cost } });
    fireEvent.click(screen.getByRole("button", { name: /\+ add holding/i }));
  }

  it("resolves a ticker on blur, shows the confirmed price, and only then allows Add", async () => {
    resolveTickerActionMock.mockResolvedValue(okResolution({ priceUsd: "228.50" }));
    render(<SetupWizard />);

    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "aapl" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Average cost per unit (USD)"), { target: { value: "150" } });

    // Not resolved yet → Add is refused.
    fireEvent.click(screen.getByRole("button", { name: /\+ add holding/i }));
    expect(screen.getByText(/resolve the ticker first/i)).toBeInTheDocument();
    expect(screen.queryByText("AAPL")).toBeNull();

    fireEvent.blur(ticker);
    await waitFor(() => expect(screen.getByText(/\$228\.50/)).toBeInTheDocument());
    expect(screen.getByText(/resolved/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /\+ add holding/i }));
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("AAPL")).toBeInTheDocument());
  });

  it("blocks a duplicate ticker case-insensitively — one combined row per asset", async () => {
    resolveTickerActionMock.mockResolvedValue(okResolution({ priceUsd: "100.00" }));
    render(<SetupWizard />);

    await addHolding("AAPL", "5", "100");
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("AAPL")).toBeInTheDocument());

    await addHolding("aapl", "3", "110");
    expect(screen.getByText(/already in your holdings/i)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByText("AAPL")).toHaveLength(1);
  });

  it("switches the cost field label when 'Total cost basis' mode is chosen", () => {
    render(<SetupWizard />);
    expect(screen.getByLabelText("Average cost per unit (USD)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /total cost basis/i }));
    expect(screen.getByLabelText("Total cost basis (USD)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Average cost per unit (USD)")).toBeNull();
  });

  it("locks the cost-entry mode once a holding exists; a blocked mode switch leaves the row's avg cost unchanged", async () => {
    resolveTickerActionMock.mockResolvedValue(okResolution({ priceUsd: "50.00" }));
    render(<SetupWizard />);

    await addHolding("AAPL", "10", "180");
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("$180.00")).toBeInTheDocument());

    const averageRadio = screen.getByRole("radio", { name: /average cost per unit/i });
    const totalRadio = screen.getByRole("radio", { name: /total cost basis/i });
    expect(averageRadio).toBeDisabled();
    expect(totalRadio).toBeDisabled();
    expect(screen.getByText(/locked once a holding is added/i)).toBeInTheDocument();

    fireEvent.click(totalRadio); // disabled → no-op
    // Mode did not change: the cost field is still labelled for "average",
    // and the existing row's frozen avg cost is untouched.
    expect(screen.getByLabelText("Average cost per unit (USD)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Total cost basis (USD)")).toBeNull();
    expect(within(screen.getByRole("table")).getByText("$180.00")).toBeInTheDocument();
  });

  it("blocks Add when the ticker was edited after resolution without re-resolving; nothing is saved under the stale id", async () => {
    resolveTickerActionMock.mockResolvedValue(okResolution({ assetId: "1", priceUsd: "228.50" }));
    render(<SetupWizard />);

    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "AAPL" } });
    fireEvent.blur(ticker);
    await waitFor(() => expect(screen.getByText(/resolved/i)).toBeInTheDocument());

    fireEvent.change(ticker, { target: { value: "MSFT" } });
    expect(screen.queryByText(/resolved/i)).toBeNull(); // resolution cleared immediately

    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Average cost per unit (USD)"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /\+ add holding/i }));

    expect(screen.getByText(/resolve the ticker first/i)).toBeInTheDocument();
    expect(screen.queryByText("MSFT")).toBeNull();
    expect(screen.queryByText("AAPL")).toBeNull();
  });

  it("requires at least one holding before 'Next: Review →' proceeds", () => {
    render(<SetupWizard />);
    fireEvent.click(screen.getByRole("button", { name: /next: review/i }));
    expect(screen.getByText(/add at least one holding/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /add your holdings/i })).toBeInTheDocument();
  });

  it("clears the stale 'Add at least one holding.' error once a holding is successfully added", async () => {
    resolveTickerActionMock.mockResolvedValue(okResolution({ priceUsd: "100.00" }));
    render(<SetupWizard />);

    // 1. Trigger the Step 1 "no holdings" error.
    fireEvent.click(screen.getByRole("button", { name: /next: review/i }));
    expect(screen.getByText(/add at least one holding/i)).toBeInTheDocument();

    // 2. Successfully add a holding.
    await addHolding("AAPL", "5", "100");

    // 3. The holding row is visible.
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("AAPL")).toBeInTheDocument());

    // 4. The stale Step 1 error is gone.
    expect(screen.queryByText(/add at least one holding/i)).toBeNull();
  });

  it("re-resolves (does not dead-end Add) when the asset type changes with a populated ticker", async () => {
    resolveTickerActionMock.mockResolvedValue(okResolution({ priceUsd: "50.00" }));
    render(<SetupWizard />);

    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "SOFI" } });
    fireEvent.blur(ticker);
    await waitFor(() => expect(resolveTickerActionMock).toHaveBeenCalledWith("SOFI", "equity"));

    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "etf" } });
    await waitFor(() => expect(resolveTickerActionMock).toHaveBeenCalledWith("SOFI", "etf"));
    await waitFor(() => expect(screen.getByText(/resolved/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Average cost per unit (USD)"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /\+ add holding/i }));
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("SOFI")).toBeInTheDocument());
  });

  it("ignores a late resolution from a superseded ticker/asset-type selection", async () => {
    let resolveOld: (v: any) => void = () => {};
    resolveTickerActionMock
      .mockImplementationOnce(() => new Promise((res) => { resolveOld = res; }))
      .mockImplementationOnce(async () => okResolution({ assetId: "NEW", priceUsd: "77.00" }));
    render(<SetupWizard />);

    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "AAA" } });
    fireEvent.blur(ticker); // call 1 (equity) — pending

    fireEvent.change(screen.getByLabelText("Asset type"), { target: { value: "etf" } }); // call 2 — resolves now
    await waitFor(() => expect(screen.getByText(/\$77\.00/)).toBeInTheDocument());

    resolveOld(okResolution({ assetId: "OLD", priceUsd: "11.00" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByText(/\$11\.00/)).toBeNull();
    expect(screen.getByText(/\$77\.00/)).toBeInTheDocument();
  });
});

describe("SetupWizard — Step 2 Review & Save", () => {
  const okResolution = () => ({
    ok: true as const,
    assetId: "1",
    assetClass: "equity" as const,
    priceUsd: "100.00",
    priceDate: "2026-08-25",
  });

  async function reachReview() {
    render(<SetupWizard />);
    fireEvent.change(screen.getByLabelText("Ticker symbol"), { target: { value: "AAPL" } });
    fireEvent.blur(screen.getByLabelText("Ticker symbol"));
    await waitFor(() => expect(screen.getByText(/resolved/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Average cost per unit (USD)"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /\+ add holding/i }));
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("AAPL")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /next: review/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /^review$/i })).toBeInTheDocument());
  }

  beforeEach(() => {
    resolveTickerActionMock.mockResolvedValue(okResolution());
  });

  it("Save is disabled while the request is in flight, fires once, then advances to Complete on 'saved'", async () => {
    let resolveSave: (v: { status: "saved"; accountId: number }) => void = () => {};
    setupAccountActionMock.mockImplementation(
      () => new Promise((res) => { resolveSave = res; })
    );

    await reachReview();
    const saveButton = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton); // second click must be ignored

    await waitFor(() => expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled());

    resolveSave({ status: "saved", accountId: 1 });

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /portfolio saved/i })).toBeInTheDocument()
    );
    expect(setupAccountActionMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /go to dashboard/i }));
    expect(pushMock).toHaveBeenCalledWith("/");
  });

  it("'save_failed' keeps the draft on Review and shows a red 'Nothing was saved' banner", async () => {
    setupAccountActionMock.mockResolvedValue({
      status: "save_failed",
      message: "That date is in the future — enter the holdings you have now.",
    });

    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^review$/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /portfolio saved/i })).toBeNull();
    // Draft intact — the holding row is still there.
    expect(within(screen.getByRole("table")).getByText("AAPL")).toBeInTheDocument();
  });

  it("'save_unknown' shows an amber 'couldn't confirm' banner, never the 'Nothing was saved' copy", async () => {
    setupAccountActionMock.mockResolvedValue({
      status: "save_unknown",
      message: "We couldn't confirm whether this saved — check the Dashboard before trying again.",
    });

    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText(/couldn't confirm whether this saved/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/nothing was saved/i)).toBeNull();
    expect(screen.queryByRole("heading", { name: /portfolio saved/i })).toBeNull();
  });

  it("a rejected setupAccountAction call shows the same amber copy and re-enables Save", async () => {
    setupAccountActionMock.mockRejectedValue(new Error("network down"));

    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText(/couldn't confirm whether this saved/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/nothing was saved/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  it("clears a stale save_failed banner when returning to Review without re-submitting", async () => {
    setupAccountActionMock.mockResolvedValue({
      status: "save_failed",
      message: "That date is in the future — enter the holdings you have now.",
    });

    await reachReview();

    // 1. save_failed → red banner on Review.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument());

    // 2. Back to Step 1.
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /add your holdings/i })).toBeInTheDocument()
    );

    // 3. Re-enter Step 2 without submitting again.
    fireEvent.click(screen.getByRole("button", { name: /next: review/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /^review$/i })).toBeInTheDocument());

    // 4. The stale banner is gone; Save is ready for a fresh attempt.
    expect(screen.queryByText(/nothing was saved/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  it("typing an intermediate invalid character on a draft field does not throw", async () => {
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: /edit/i })); // back to Step 1
    const qty = screen.getByLabelText("Quantity");
    expect(() => {
      fireEvent.change(qty, { target: { value: "1." } });
      fireEvent.change(qty, { target: { value: "1.e" } });
      fireEvent.change(qty, { target: { value: "-" } });
    }).not.toThrow();
  });

  it("clears the 'checking…' status when a pending resolution is invalidated by editing the ticker", async () => {
    resolveTickerActionMock.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<SetupWizard />);

    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "AAA" } });
    fireEvent.blur(ticker);
    await waitFor(() => expect(screen.getByText(/checking/i)).toBeInTheDocument());

    fireEvent.change(ticker, { target: { value: "AAB" } });
    expect(screen.queryByText(/checking/i)).toBeNull();
  });
});

describe("SetupWizard — Task 29 status & accessibility", () => {
  it("announces a resolved ticker result in a polite live region", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: true,
      assetId: "1",
      assetClass: "equity",
      priceUsd: "228.50",
      priceDate: "2026-08-25",
    });
    render(<SetupWizard />);
    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "AAPL" } });
    fireEvent.blur(ticker);

    const msg = await screen.findByText(/resolved — last price \$228\.50/i);
    const live = msg.closest("[aria-live]");
    expect(live).not.toBeNull();
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(msg.closest('[role="alert"]')).toBeNull();
  });

  it("announces a not-found ticker result politely, without an assertive alert on Step 1", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: false,
      assetId: "1",
      message:
        'Couldn\'t find a price for "ZZZZ". Check the symbol, or add it anyway if you\'re sure it\'s correct.',
    });
    render(<SetupWizard />);
    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "ZZZZ" } });
    fireEvent.blur(ticker);

    const msg = await screen.findByText(/couldn't find a price for "ZZZZ"/i);
    expect(msg.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(msg.closest('[role="alert"]')).toBeNull();
    // Step 1 keeps no assertive alert — the resolution result is polite only.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("SetupWizard — Task 32: responsive + accessible polish", () => {
  const ok = (over: Partial<{ priceUsd: string; assetId: string }> = {}) => ({
    ok: true as const,
    assetId: over.assetId ?? "1",
    assetClass: "equity" as const,
    priceUsd: over.priceUsd ?? "100.00",
    priceDate: "2026-08-25",
  });

  async function addHolding(ticker: string, qty: string, cost: string) {
    fireEvent.change(screen.getByLabelText("Ticker symbol"), { target: { value: ticker } });
    fireEvent.blur(screen.getByLabelText("Ticker symbol"));
    await waitFor(() => expect(screen.getByText(/resolved/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: qty } });
    fireEvent.change(screen.getByLabelText("Average cost per unit (USD)"), { target: { value: cost } });
    fireEvent.click(screen.getByRole("button", { name: /\+ add holding/i }));
    await waitFor(() => expect(within(screen.getByRole("table")).getByText(ticker)).toBeInTheDocument());
  }

  async function reachReview() {
    await addHolding("AAPL", "10", "150");
    fireEvent.click(screen.getByRole("button", { name: /next: review/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /^review$/i })).toBeInTheDocument());
  }

  it("T32-1: shows a plain 'Step 1 of 2' / 'Step 2 of 2' indicator that is not a button or link", async () => {
    resolveTickerActionMock.mockResolvedValue(ok());
    render(<SetupWizard />);

    const s1 = screen.getByText("Step 1 of 2");
    expect(s1).toBeInTheDocument();
    expect(s1.closest("button")).toBeNull();
    expect(s1.closest("a")).toBeNull();
    expect(screen.queryByRole("button", { name: /step 1 of 2/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /step 1 of 2/i })).toBeNull();
    expect(screen.queryByText("Step 2 of 2")).toBeNull();

    await reachReview();

    const s2 = screen.getByText("Step 2 of 2");
    expect(s2.closest("button")).toBeNull();
    expect(s2.closest("a")).toBeNull();
    expect(screen.queryByText("Step 1 of 2")).toBeNull();
  });

  it("T32-2: Step 1 entered-holdings table is wrapped in .editor-table with ordered .cell-label labels; action cell has none", async () => {
    resolveTickerActionMock.mockResolvedValue(ok());
    render(<SetupWizard />);
    await addHolding("AAPL", "10", "150");

    const table = screen.getByRole("table");
    expect(table.closest(".editor-table")).not.toBeNull();

    const dataRow = within(table).getAllByRole("row")[1];
    const labels = within(dataRow)
      .getAllByRole("cell")
      .map((c) => c.querySelector(".cell-label")?.textContent ?? null);
    expect(labels).toEqual(["Ticker", "Type", "Qty", "Avg cost", "Cost basis", null]);
  });

  it("T32-3: Step 2 Review table is wrapped in .editor-table with the same 5 ordered .cell-label labels", async () => {
    resolveTickerActionMock.mockResolvedValue(ok());
    render(<SetupWizard />);
    await reachReview();

    const table = screen.getByRole("table");
    expect(table.closest(".editor-table")).not.toBeNull();

    const dataRow = within(table).getAllByRole("row")[1];
    const labels = within(dataRow)
      .getAllByRole("cell")
      .map((c) => c.querySelector(".cell-label")?.textContent ?? null);
    expect(labels).toEqual(["Ticker", "Type", "Qty", "Avg cost", "Cost basis"]);
  });

  it("T32-4: Step 1 row-action buttons carry per-row 'Edit <TICKER>' / 'Remove <TICKER>' names, one each", async () => {
    resolveTickerActionMock.mockImplementation(async (sym: string) => ok({ assetId: sym }));
    render(<SetupWizard />);
    await addHolding("AAPL", "10", "150");
    await addHolding("MSFT", "5", "200");

    expect(screen.getByRole("button", { name: "Edit AAPL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove AAPL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit MSFT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove MSFT" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Edit \S/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Remove \S/ })).toHaveLength(2);
  });

  it("T32-5: ticker-resolution stays a single always-mounted polite live region; 'Add anyway' is outside it", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: false,
      assetId: "1",
      message:
        'Couldn\'t find a price for "ZZZZ". Check the symbol, or add it anyway if you\'re sure it\'s correct.',
    });
    render(<SetupWizard />);

    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(document.querySelector('[aria-live="polite"]')).toHaveAttribute("aria-atomic", "true");

    const ticker = screen.getByLabelText("Ticker symbol");
    fireEvent.change(ticker, { target: { value: "ZZZZ" } });
    fireEvent.blur(ticker);

    const addAnyway = await screen.findByRole("button", { name: /add anyway/i });
    expect(addAnyway.closest("[aria-live]")).toBeNull();
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });

  it("T32-6: exactly one set of form controls / actions per step — no duplicated mobile markup", async () => {
    resolveTickerActionMock.mockResolvedValue(ok());
    render(<SetupWizard />);

    expect(screen.getAllByLabelText("Ticker symbol")).toHaveLength(1);
    expect(screen.getAllByLabelText("Quantity")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /next: review/i })).toHaveLength(1);

    await addHolding("AAPL", "10", "150");
    expect(screen.getAllByRole("table")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /next: review/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /^review$/i })).toBeInTheDocument());

    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^save$/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^←? ?back$/i })).toHaveLength(1);
  });
});
