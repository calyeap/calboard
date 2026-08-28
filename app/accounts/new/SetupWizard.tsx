"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { localTodayIso } from "@/lib/dateValidation";
import type { AssetClass } from "@/lib/assets";
import { resolveTickerAction, setupAccountAction, type TickerResolutionResult } from "@/app/actions/setup";
import { computeAvgCostUsd, isDuplicateTickerInDraft, type CostBasisMode } from "@/lib/wizard/draftHoldings";

type Step = 1 | 2 | "complete";

interface DraftHolding {
  ticker: string; // normalized (uppercase)
  assetId: string;
  assetType: AssetClass;
  quantity: Decimal;
  avgCostUsd: Decimal; // derived once, at entry — frozen thereafter
}

export function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  // Step 1 — the only "current as of" date for the whole snapshot. Defaults
  // to today and is not prominent; an older date is reachable only via the
  // "Change date" affordance. Never called a "trade date" / "effective
  // date" / "opening" date — this is a mirror of what you hold now.
  const [asOfDate, setAsOfDate] = useState(localTodayIso());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // Cost-basis mode is chosen once for the whole snapshot, then locked as
  // soon as the first holding is added (spec §4). "total" is divided by
  // quantity to the average cost that storage actually keeps.
  const [costBasisMode, setCostBasisMode] = useState<CostBasisMode>("average");
  const [holdings, setHoldings] = useState<DraftHolding[]>([]);

  // Add-a-holding draft row.
  const [tickerInput, setTickerInput] = useState("");
  const [assetType, setAssetType] = useState<AssetClass>("equity");
  const [quantityInput, setQuantityInput] = useState("");
  const [costInput, setCostInput] = useState("");
  const [holdingError, setHoldingError] = useState<string | null>(null);

  // Resolution state. `resolvedTicker`/`resolvedAssetClass`/`draftAssetId`
  // capture what the current identity was actually resolved for; editing the
  // ticker text clears them immediately, and changing the asset type
  // re-resolves — so a stale identity can never be saved under a different
  // symbol or class. `resolveSeq` makes a late response from a superseded
  // request unable to overwrite the latest selection.
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState<TickerResolutionResult | null>(null);
  const [resolvedTicker, setResolvedTicker] = useState<string | null>(null);
  const [resolvedAssetClass, setResolvedAssetClass] = useState<AssetClass | null>(null);
  const [draftAssetId, setDraftAssetId] = useState<string | null>(null);
  const resolveSeq = useRef(0);

  // Step 2 — plain Review & Save. No sign-off checkbox, no statement-match
  // framing, no post-save verification screen (spec revision 3 §3.3).
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ kind: "failed" | "unknown"; message: string } | null>(null);
  // A synchronous guard: two clicks dispatched before React re-renders the
  // disabled button would both pass a state-based check (stale closure), so
  // the in-flight flag that actually blocks the second call is a ref.
  const savingRef = useRef(false);

  const modeLocked = holdings.length > 0;
  const costLabel = costBasisMode === "average" ? "Average cost per unit (USD)" : "Total cost basis (USD)";

  const totalCostBasisEntered = holdings.reduce(
    (sum, h) => sum.add(h.quantity.mul(h.avgCostUsd)),
    new Decimal(0)
  );

  async function handleSave() {
    if (savingRef.current) return; // no double-submit
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await setupAccountAction({
        asOfDate,
        holdings: holdings.map((h) => ({
          assetId: h.assetId,
          quantity: h.quantity.toString(),
          avgCostUsd: h.avgCostUsd.toString(),
        })),
      });
      if (result.status === "saved") {
        setStep("complete");
        return;
      }
      if (result.status === "save_failed") {
        setSaveError({ kind: "failed", message: result.message });
        return;
      }
      // save_unknown — the COMMIT was genuinely ambiguous.
      setSaveError({ kind: "unknown", message: result.message });
    } catch {
      // The action call itself rejected (transport failure) — same honest
      // "we don't know" copy as save_unknown, never "nothing was saved".
      setSaveError({
        kind: "unknown",
        message: "We couldn't confirm whether this saved — check the Dashboard before trying again.",
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const hasEnteredContent = asOfDate !== localTodayIso() || holdings.length > 0;

  function handleCancel() {
    if (hasEnteredContent && !window.confirm("Discard this setup? Nothing has been saved yet.")) {
      return;
    }
    router.push("/holdings");
  }

  function clearResolution() {
    setResolution(null);
    setResolvedTicker(null);
    setResolvedAssetClass(null);
    setDraftAssetId(null);
    // Invalidating a resolution also ends the "checking…" state; a request
    // superseded without starting another would otherwise leave the spinner
    // stuck (its own finally bails out on the sequence mismatch). resolveFor
    // re-sets this to true immediately after calling clearResolution().
    setResolving(false);
  }

  // Race-safe: every call takes the next sequence number and its response is
  // applied only if it is still the latest. `forAssetClass` is passed
  // explicitly so a select change re-resolves against the NEW class even
  // though React state may not have updated within the same event tick.
  async function resolveFor(rawTicker: string, forAssetClass: AssetClass) {
    const normalized = rawTicker.trim().toUpperCase();
    const seq = ++resolveSeq.current;
    if (!normalized) {
      clearResolution();
      setResolving(false);
      return;
    }
    clearResolution();
    setResolving(true);
    try {
      const result = await resolveTickerAction(normalized, forAssetClass);
      if (seq !== resolveSeq.current) return; // superseded by a newer request
      setResolution(result);
      setResolvedTicker(normalized);
      setResolvedAssetClass(forAssetClass);
      setDraftAssetId(result.assetId);
    } finally {
      if (seq === resolveSeq.current) setResolving(false);
    }
  }

  function addHolding() {
    setHoldingError(null);
    const normalized = tickerInput.trim().toUpperCase();
    if (!normalized) {
      setHoldingError("Enter a ticker symbol.");
      return;
    }
    if (!draftAssetId || resolvedTicker !== normalized || resolvedAssetClass !== assetType) {
      setHoldingError("Resolve the ticker first — enter it and tab out, or press Add anyway.");
      return;
    }
    if (isDuplicateTickerInDraft(holdings.map((h) => h.ticker), normalized)) {
      setHoldingError(`${normalized} is already in your holdings — enter one combined row per asset.`);
      return;
    }

    let quantity: Decimal;
    let costRaw: Decimal;
    try {
      quantity = new Decimal(quantityInput);
    } catch {
      setHoldingError("Quantity must be a number.");
      return;
    }
    try {
      costRaw = new Decimal(costInput);
    } catch {
      setHoldingError("Cost must be a number.");
      return;
    }
    if (!quantity.isFinite() || quantity.lte(0)) {
      setHoldingError("Quantity must be greater than zero.");
      return;
    }
    if (!costRaw.isFinite() || costRaw.lte(0)) {
      setHoldingError("Cost must be greater than zero.");
      return;
    }

    let avgCostUsd: Decimal;
    try {
      avgCostUsd = computeAvgCostUsd(quantity, costRaw, costBasisMode);
    } catch (err) {
      setHoldingError(err instanceof Error ? err.message : "Could not compute the average cost.");
      return;
    }

    setHoldings((hs) => [...hs, { ticker: normalized, assetId: draftAssetId, assetType, quantity, avgCostUsd }]);
    setTickerInput("");
    setAssetType("equity");
    setQuantityInput("");
    setCostInput("");
    clearResolution();
    // A prior "Add at least one holding." (or other Step 1) error is now
    // stale — the list is no longer empty.
    setStep1Error(null);
  }

  function removeHolding(index: number) {
    setHoldings((hs) => hs.filter((_, i) => i !== index));
  }

  function editHolding(index: number) {
    const h = holdings[index];
    setHoldings((hs) => hs.filter((_, i) => i !== index));
    setTickerInput(h.ticker);
    setAssetType(h.assetType);
    setQuantityInput(h.quantity.toString());
    // Seed the cost field so re-adding under the CURRENT mode reproduces the
    // same average cost, whichever mode is active now.
    setCostInput(
      costBasisMode === "average" ? h.avgCostUsd.toString() : h.avgCostUsd.mul(h.quantity).toString()
    );
    // Its identity was already resolved for this ticker and type — carry
    // both so an unchanged re-add needs no fresh resolution, and bump the
    // resolve sequence so any in-flight request can't clobber it (and can't
    // leave the "checking…" spinner stuck).
    resolveSeq.current++;
    setResolving(false);
    setDraftAssetId(h.assetId);
    setResolvedTicker(h.ticker);
    setResolvedAssetClass(h.assetType);
    setResolution(null);
    setHoldingError(null);
  }

  function goToStep2() {
    if (!asOfDate) {
      setStep1Error("Choose the date these figures are current as of.");
      return;
    }
    if (asOfDate > localTodayIso()) {
      setStep1Error("That date is in the future — enter the holdings you have now.");
      return;
    }
    if (holdings.length === 0) {
      setStep1Error("Add at least one holding.");
      return;
    }
    setStep1Error(null);
    // A prior save_failed banner must not survive a trip back to Step 1 and
    // reappear on Review before the user has actually re-submitted.
    setSaveError(null);
    setStep(2);
  }

  return (
    <div className="wizard">
      {step === 1 && (
        <section>
          <h1>Add your holdings</h1>
          <p className="wizard-step">Step 1 of 2</p>
          <p>
            Calboard mirrors the equities and crypto you already hold elsewhere, as one combined
            portfolio. Enter what you hold now; update it here whenever your real holdings change.
            Calboard never places trades — you keep doing that in your own trading app.
          </p>

          <div className="wizard-section">
            <p className="wizard-note">
              These figures are current as of {asOfDate}.{" "}
              {!datePickerOpen && (
                <button type="button" onClick={() => setDatePickerOpen(true)}>
                  Change date
                </button>
              )}
            </p>
            {datePickerOpen && (
              <p>
                <label htmlFor="as-of-date">As of </label>
                <input
                  id="as-of-date"
                  type="date"
                  aria-label="As-of date"
                  value={asOfDate}
                  max={localTodayIso()}
                  onChange={(e) => setAsOfDate(e.target.value)}
                />
              </p>
            )}
          </div>

          <div className="wizard-section">
            <fieldset disabled={modeLocked}>
              <legend>How are you entering cost?</legend>
              <label>
                <input
                  type="radio"
                  name="cost-basis-mode"
                  disabled={modeLocked}
                  checked={costBasisMode === "average"}
                  onChange={() => {
                    if (!modeLocked) setCostBasisMode("average");
                  }}
                />{" "}
                Average cost per unit
              </label>{" "}
              <label>
                <input
                  type="radio"
                  name="cost-basis-mode"
                  disabled={modeLocked}
                  checked={costBasisMode === "total"}
                  onChange={() => {
                    if (!modeLocked) setCostBasisMode("total");
                  }}
                />{" "}
                Total cost basis
              </label>
            </fieldset>
            {modeLocked && (
              <p className="wizard-note">
                Cost-entry method is locked once a holding is added — remove all holdings to change it.
              </p>
            )}
          </div>

          <div className="wizard-section wizard-add">
            <label>
              Ticker symbol
              <br />
              <input
                aria-label="Ticker symbol"
                value={tickerInput}
                onChange={(e) => {
                  setTickerInput(e.target.value);
                  // Invalidate any in-flight resolution for the old text; a
                  // blur re-resolves for the new one.
                  resolveSeq.current++;
                  clearResolution();
                }}
                onBlur={() => void resolveFor(tickerInput, assetType)}
              />
            </label>
            {/* One polite live region for every ticker-resolution state, so a
                screen reader hears the meaningful result without an assertive
                interruption and without a second region repeating it. The
                "Add anyway" affordance sits outside it. */}
            <div aria-live="polite" aria-atomic="true">
              {resolving && <span className="status-neutral">checking…</span>}
              {resolution?.ok && (
                <span className="status-success">
                  ✓ Resolved — last price ${resolution.priceUsd} ({resolution.priceDate})
                </span>
              )}
              {resolution && !resolution.ok && (
                <span className="status-warning">{resolution.message}</span>
              )}
            </div>
            {resolution && !resolution.ok && draftAssetId && (
              <button type="button" onClick={addHolding}>
                Add anyway
              </button>
            )}

            <label>
              Asset type
              <br />
              <select
                aria-label="Asset type"
                value={assetType}
                onChange={(e) => {
                  const next = e.target.value as AssetClass;
                  setAssetType(next);
                  if (tickerInput.trim()) {
                    // Re-resolve against the NEW class rather than
                    // dead-ending Add; pass it explicitly (state may be
                    // stale this tick).
                    void resolveFor(tickerInput, next);
                  } else {
                    resolveSeq.current++;
                    clearResolution();
                  }
                }}
              >
                <option value="equity">Equity</option>
                <option value="etf">ETF</option>
                <option value="crypto">Crypto</option>
              </select>
            </label>

            <label>
              Quantity
              <br />
              <input aria-label="Quantity" value={quantityInput} onChange={(e) => setQuantityInput(e.target.value)} />
            </label>

            <label>
              {costLabel}
              <br />
              <input aria-label={costLabel} value={costInput} onChange={(e) => setCostInput(e.target.value)} />
            </label>

            <button type="button" onClick={addHolding}>
              + Add holding
            </button>
            {holdingError && <span className="status-msg status-danger">{holdingError}</span>}
          </div>

          {holdings.length > 0 && (
            <div className="editor-table">
            <table border={1} cellPadding={6} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Avg cost</th>
                  <th>Cost basis</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, i) => (
                  <tr key={h.ticker}>
                    <td>
                      <span className="cell-label">Ticker</span>
                      {h.ticker}
                    </td>
                    <td>
                      <span className="cell-label">Type</span>
                      {h.assetType}
                    </td>
                    <td>
                      <span className="cell-label">Qty</span>
                      {h.quantity.toString()}
                    </td>
                    <td>
                      <span className="cell-label">Avg cost</span>
                      ${h.avgCostUsd.toFixed(2)}
                    </td>
                    <td>
                      <span className="cell-label">Cost basis</span>
                      ${h.quantity.mul(h.avgCostUsd).toFixed(2)}
                    </td>
                    <td>
                      <button type="button" aria-label={`Edit ${h.ticker}`} onClick={() => editHolding(i)}>
                        Edit
                      </button>{" "}
                      <button type="button" aria-label={`Remove ${h.ticker}`} onClick={() => removeHolding(i)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          {step1Error && <p className="status-msg status-danger">{step1Error}</p>}

          <div className="wizard-actions">
            <button type="button" onClick={handleCancel}>
              Cancel setup
            </button>{" "}
            <button type="button" className="primary" onClick={goToStep2}>
              Next: Review →
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h1>Review</h1>
          <p className="wizard-step">Step 2 of 2</p>

          <div className="wizard-section">
            <p className="wizard-note">Nothing has been saved yet.</p>
            <p>
              These figures are current as of {asOfDate}.{" "}
              <button type="button" onClick={() => setStep(1)}>
                Edit
              </button>
            </p>
          </div>

          <div className="editor-table">
          <table border={1} cellPadding={6} style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Avg cost</th>
                <th>Cost basis</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.ticker}>
                  <td>
                    <span className="cell-label">Ticker</span>
                    {h.ticker}
                  </td>
                  <td>
                    <span className="cell-label">Type</span>
                    {h.assetType}
                  </td>
                  <td>
                    <span className="cell-label">Qty</span>
                    {h.quantity.toString()}
                  </td>
                  <td>
                    <span className="cell-label">Avg cost</span>
                    ${h.avgCostUsd.toFixed(2)}
                  </td>
                  <td>
                    <span className="cell-label">Cost basis</span>
                    ${h.quantity.mul(h.avgCostUsd).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <p>
            Total cost basis entered: ${totalCostBasisEntered.toFixed(2)} — what you paid, not today&apos;s
            market value.
          </p>

          {saveError?.kind === "failed" && (
            <p className="status-msg status-danger" role="alert">
              Nothing was saved. {saveError.message} Fix the issue and try again.{" "}
              <button type="button" onClick={() => setStep(1)}>
                Take me to the problem
              </button>
            </p>
          )}
          {saveError?.kind === "unknown" && (
            <p className="status-msg status-warning" role="alert">
              {saveError.message}
            </p>
          )}

          <div className="wizard-actions">
            <button type="button" onClick={() => setStep(1)}>
              ← Back
            </button>{" "}
            <button type="button" className="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </section>
      )}

      {step === "complete" && (
        <section>
          <h1>Portfolio saved</h1>
          <button type="button" onClick={() => router.push("/")}>
            Go to dashboard →
          </button>
        </section>
      )}
    </div>
  );
}
