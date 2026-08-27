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

  // Resolution state. `resolvedTicker`/`draftAssetId` capture what the
  // current identity was actually resolved for; editing the ticker text or
  // the asset type clears them immediately so a stale identity can never be
  // saved under a different symbol.
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState<TickerResolutionResult | null>(null);
  const [resolvedTicker, setResolvedTicker] = useState<string | null>(null);
  const [draftAssetId, setDraftAssetId] = useState<string | null>(null);

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
    setDraftAssetId(null);
  }

  async function handleTickerBlur() {
    const normalized = tickerInput.trim().toUpperCase();
    if (!normalized) {
      clearResolution();
      return;
    }
    setResolving(true);
    setResolution(null);
    try {
      const result = await resolveTickerAction(normalized, assetType);
      setResolution(result);
      setResolvedTicker(normalized);
      setDraftAssetId(result.assetId);
    } finally {
      setResolving(false);
    }
  }

  function addHolding() {
    setHoldingError(null);
    const normalized = tickerInput.trim().toUpperCase();
    if (!normalized) {
      setHoldingError("Enter a ticker symbol.");
      return;
    }
    if (!draftAssetId || resolvedTicker !== normalized) {
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
    // Its identity was already resolved for this ticker — carry it so an
    // unchanged re-add needs no fresh resolution.
    setDraftAssetId(h.assetId);
    setResolvedTicker(h.ticker);
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
    setStep(2);
  }

  return (
    <div style={{ fontFamily: "system-ui" }}>
      {step === 1 && (
        <section>
          <h1>Add your holdings</h1>
          <p>
            Calboard mirrors the equities and crypto you already hold elsewhere, as one combined
            portfolio. Enter what you hold now; update it here whenever your real holdings change.
            Calboard never places trades — you keep doing that in your own trading app.
          </p>

          <p style={{ color: "#555" }}>
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

          <fieldset disabled={modeLocked} style={{ marginTop: "1rem" }}>
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
            <p style={{ color: "#666", fontSize: "0.9rem" }}>
              Cost-entry method is locked once a holding is added — remove all holdings to change it.
            </p>
          )}

          <div style={{ marginTop: "1rem", display: "grid", gap: "0.5rem", maxWidth: 360 }}>
            <label>
              Ticker symbol
              <br />
              <input
                aria-label="Ticker symbol"
                value={tickerInput}
                onChange={(e) => {
                  setTickerInput(e.target.value);
                  clearResolution();
                }}
                onBlur={handleTickerBlur}
              />
            </label>
            {resolving && <span>checking…</span>}
            {resolution?.ok && (
              <span>
                ✓ Resolved — last price ${resolution.priceUsd} ({resolution.priceDate})
              </span>
            )}
            {resolution && !resolution.ok && (
              <span>
                {resolution.message}{" "}
                {draftAssetId && (
                  <button type="button" onClick={addHolding}>
                    Add anyway
                  </button>
                )}
              </span>
            )}

            <label>
              Asset type
              <br />
              <select
                aria-label="Asset type"
                value={assetType}
                onChange={(e) => {
                  setAssetType(e.target.value as AssetClass);
                  clearResolution();
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
            {holdingError && <span style={{ color: "#b00020" }}>{holdingError}</span>}
          </div>

          {holdings.length > 0 && (
            <table border={1} cellPadding={6} style={{ marginTop: "1rem", borderCollapse: "collapse" }}>
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
                    <td>{h.ticker}</td>
                    <td>{h.assetType}</td>
                    <td>{h.quantity.toString()}</td>
                    <td>${h.avgCostUsd.toFixed(2)}</td>
                    <td>${h.quantity.mul(h.avgCostUsd).toFixed(2)}</td>
                    <td>
                      <button type="button" onClick={() => editHolding(i)}>
                        Edit
                      </button>{" "}
                      <button type="button" onClick={() => removeHolding(i)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {step1Error && <p style={{ color: "#b00020" }}>{step1Error}</p>}

          <div style={{ marginTop: "1.5rem" }}>
            <button type="button" onClick={handleCancel}>
              Cancel setup
            </button>{" "}
            <button type="button" onClick={goToStep2}>
              Next: Review →
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h1>Review</h1>
          <p style={{ color: "#555" }}>Nothing has been saved yet.</p>

          <p>
            These figures are current as of {asOfDate}.{" "}
            <button type="button" onClick={() => setStep(1)}>
              Edit
            </button>
          </p>

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
                  <td>{h.ticker}</td>
                  <td>{h.assetType}</td>
                  <td>{h.quantity.toString()}</td>
                  <td>${h.avgCostUsd.toFixed(2)}</td>
                  <td>${h.quantity.mul(h.avgCostUsd).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p>
            Total cost basis entered: ${totalCostBasisEntered.toFixed(2)} — what you paid, not today&apos;s
            market value.
          </p>

          {saveError?.kind === "failed" && (
            <p style={{ color: "#b00020" }} role="alert">
              Nothing was saved. {saveError.message} Fix the issue and try again.{" "}
              <button type="button" onClick={() => setStep(1)}>
                Take me to the problem
              </button>
            </p>
          )}
          {saveError?.kind === "unknown" && (
            <p style={{ color: "#a15c00" }} role="alert">
              {saveError.message}
            </p>
          )}

          <div style={{ marginTop: "1.5rem" }}>
            <button type="button" onClick={() => setStep(1)}>
              ← Back
            </button>{" "}
            <button type="button" onClick={handleSave} disabled={saving}>
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
