"use client";

import { useEffect, useRef, useState } from "react";
import Decimal from "decimal.js";
import { localTodayIso } from "@/lib/dateValidation";
import { formatAssetClass, type AssetClass } from "@/lib/assetClass";
import type { PriceStatus } from "@/lib/portfolio";
import { PriceCell } from "@/app/components/PriceCell";
import { MaskableValue } from "@/app/components/MaskableValue";
import { usePrivacy } from "@/app/components/PrivacyContext";
import { resolveTickerAction, type TickerResolutionResult } from "@/app/actions/setup";
import { updateHoldingsAction } from "@/app/actions/holdings";
import { isDuplicateTickerInDraft } from "@/lib/wizard/draftHoldings";

export interface EditorInitialRow {
  assetId: string;
  symbol: string;
  assetClass: AssetClass;
  quantity: string; // serialized Decimal
  avgCostUsd: string; // serialized Decimal
  priceUsd: string | null;
  priceStatus: PriceStatus;
  priceDate: string | null;
}

interface Row extends EditorInitialRow {
  initialQuantity: string; // "" for a row added in this session
  initialAvgCostUsd: string; // ""
  removed: boolean;
  isNew: boolean;
}

function toRow(r: EditorInitialRow): Row {
  return {
    ...r,
    initialQuantity: r.quantity,
    initialAvgCostUsd: r.avgCostUsd,
    removed: false,
    isNew: false,
  };
}

// Non-throwing — an in-progress keystroke like "1." must never crash a
// render path (values are validated for real by updateHoldingsAction).
function tryDecimal(s: string): Decimal | null {
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function isZeroQty(s: string): boolean {
  const d = tryDecimal(s);
  return d !== null && d.isZero();
}

// Live derived figures — market value = quantity × latest price, unrealised
// gain/loss = (price − avgCost) × quantity, the same formula lib/portfolio.ts
// uses for the Dashboard row/aggregate. A price-unavailable holding shows
// nothing (preserved from Task 16/17); a stale price still contributes.
function derived(r: Row): { mv: string; pl: string } {
  const price = r.priceStatus === "unavailable" ? null : tryDecimal(r.priceUsd ?? "");
  const qty = tryDecimal(r.quantity);
  const avg = tryDecimal(r.avgCostUsd);
  if (!price || !qty) return { mv: "—", pl: "—" };
  const pl = avg ? price.sub(avg).mul(qty) : null;
  return { mv: qty.mul(price).toFixed(2), pl: pl ? pl.toFixed(2) : "—" };
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "failed"; errors: Record<string, string> }
  | { kind: "unknown"; message: string }
  | { kind: "unreachable" };

// /holdings IS the editor — every current holding is a pre-filled, editable
// row of the one combined portfolio. No recap table, no cash, no
// source/broker, no Buy/Sell/Deposit/Withdrawal. Save writes a snapshot
// update through updateHoldingsAction (one ADJUSTMENT per changed holding +
// one snapshot_confirm row); it never creates another account.
export function HoldingsEditor({ initial }: { initial: EditorInitialRow[] }) {
  const { hidden } = usePrivacy();
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [asOfDate, setAsOfDate] = useState(localTodayIso());

  // `initial` is read once by the lazy initializer above, so a server
  // re-render (e.g. PriceRefreshControl's global refresh -> router.refresh)
  // would otherwise be ignored by the mounted editor. Sync ONLY the
  // refreshed price metadata (priceUsd / priceStatus / priceDate) into
  // matching existing rows, keyed
  // by assetId — never touching quantity, average cost, baselines, removed
  // state, row order, or rows added in this session (absent from `initial`).
  // Returns the current array unchanged when nothing moved, so this causes
  // no re-render churn and never remounts the editor.
  useEffect(() => {
    const meta = new Map(
      initial.map((r) => [
        r.assetId,
        { priceUsd: r.priceUsd, priceStatus: r.priceStatus, priceDate: r.priceDate },
      ])
    );
    setRows((rs) => {
      let changed = false;
      const next = rs.map((r) => {
        const m = meta.get(r.assetId);
        if (
          !m ||
          (r.priceUsd === m.priceUsd &&
            r.priceStatus === m.priceStatus &&
            r.priceDate === m.priceDate)
        ) {
          return r;
        }
        changed = true;
        return { ...r, priceUsd: m.priceUsd, priceStatus: m.priceStatus, priceDate: m.priceDate };
      });
      return changed ? next : rs;
    });
  }, [initial]);

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  // Any structural or field change makes a prior *definitive* Save outcome
  // obsolete — clear a stale "Holdings updated." or an index-keyed field
  // error so it can't drift onto a row it no longer describes. An
  // indeterminate outcome ("couldn't confirm" / "couldn't reach the server")
  // is NOT resolved by editing — keep it visible until the next real Save.
  function clearSaveState() {
    setSave((s) => (s.kind === "failed" || s.kind === "saved" ? { kind: "idle" } : s));
  }

  // Add-a-holding draft row — mirrors the wizard's Step 1 resolver + the
  // resolved-ticker staleness guard, plus a race-safe request counter.
  const [tickerInput, setTickerInput] = useState("");
  const [assetType, setAssetType] = useState<AssetClass>("equity");
  const [addQty, setAddQty] = useState("");
  const [addCost, setAddCost] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState<TickerResolutionResult | null>(null);
  const [resolvedTicker, setResolvedTicker] = useState<string | null>(null);
  const [resolvedAssetClass, setResolvedAssetClass] = useState<AssetClass | null>(null);
  const [draftAssetId, setDraftAssetId] = useState<string | null>(null);
  const resolveSeq = useRef(0);

  function clearResolution() {
    setResolution(null);
    setResolvedTicker(null);
    setResolvedAssetClass(null);
    setDraftAssetId(null);
    // Invalidating a resolution also ends the "checking…" state — otherwise
    // a request superseded without starting another leaves the spinner stuck
    // (its own finally bails out on the sequence mismatch). resolveFor
    // re-sets this to true immediately after calling clearResolution().
    setResolving(false);
  }

  // Race-safe: every call takes the next sequence number; a response is
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

  function addRow() {
    setAddError(null);
    clearSaveState();
    const normalized = tickerInput.trim().toUpperCase();
    if (!normalized) {
      setAddError("Enter a ticker symbol.");
      return;
    }
    // Staleness guard: the current identity must have been resolved for
    // exactly this normalized symbol AND the currently selected asset type.
    if (!draftAssetId || resolvedTicker !== normalized || resolvedAssetClass !== assetType) {
      setAddError("Resolve the ticker first — enter it and tab out.");
      return;
    }
    if (isDuplicateTickerInDraft(rows.map((r) => r.symbol), normalized)) {
      setAddError(`${normalized} is already in your holdings — edit its row above.`);
      return;
    }
    const qty = tryDecimal(addQty);
    const cost = tryDecimal(addCost);
    if (!qty || qty.lte(0)) {
      setAddError("Quantity must be greater than zero.");
      return;
    }
    if (!cost || cost.lte(0)) {
      setAddError("Average cost must be greater than zero.");
      return;
    }
    setRows((rs) => [
      ...rs,
      {
        assetId: draftAssetId,
        symbol: normalized,
        assetClass: assetType,
        quantity: addQty,
        avgCostUsd: addCost,
        priceUsd: resolution && resolution.ok ? resolution.priceUsd : null,
        priceStatus: resolution && resolution.ok ? "current" : "unavailable",
        priceDate: resolution && resolution.ok ? resolution.priceDate : null,
        initialQuantity: "",
        initialAvgCostUsd: "",
        removed: false,
        isNew: true,
      },
    ]);
    setTickerInput("");
    setAssetType("equity");
    setAddQty("");
    setAddCost("");
    clearResolution();
  }

  function patchRow(i: number, patch: Partial<Row>) {
    clearSaveState();
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    clearSaveState();
    setRows((rs) => {
      const target = rs[i];
      if (target.isNew) return rs.filter((_, idx) => idx !== i);
      return rs.map((r, idx) => (idx === i ? { ...r, removed: true, quantity: "0" } : r));
    });
  }

  function undoRemove(i: number) {
    clearSaveState();
    setRows((rs) =>
      rs.map((r, idx) => (idx === i ? { ...r, removed: false, quantity: r.initialQuantity } : r))
    );
  }

  // Spec: when a row's quantity is raised but its average cost is left as it
  // was, remind the user — without blocking Save — that the stored average
  // still stands.
  function avgCostNote(r: Row): string | null {
    if (r.removed || r.isNew) return null;
    if (r.avgCostUsd.trim() !== r.initialAvgCostUsd.trim()) return null;
    const now = tryDecimal(r.quantity);
    const before = tryDecimal(r.initialQuantity);
    if (!now || !before || now.lte(before)) return null;
    const avg = tryDecimal(r.initialAvgCostUsd);
    const shown = avg ? avg.toFixed(2) : r.initialAvgCostUsd;
    return `Your existing average cost is $${shown}. Update it if your real average cost changed.`;
  }

  const futureDate = asOfDate > localTodayIso();

  async function handleSave() {
    if (savingRef.current) return;
    if (!asOfDate || futureDate) {
      setSave({
        kind: "failed",
        errors: {
          asOfDate: !asOfDate
            ? "Choose the date these figures are current as of."
            : "That date is in the future — enter the holdings you have now.",
        },
      });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSave({ kind: "idle" });
    try {
      const holdings = rows.map((r) =>
        r.removed
          ? // A removed row is always an existing holding — submit its valid
            // stored average cost, never whatever the (disabled) live field holds.
            { assetId: r.assetId, quantity: "0", avgCostUsd: r.initialAvgCostUsd }
          : { assetId: r.assetId, quantity: r.quantity, avgCostUsd: r.avgCostUsd }
      );
      const result = await updateHoldingsAction({ asOfDate, holdings });
      if (result.ok === true) {
        // Rebase the baseline to the saved values so the avg-cost note
        // clears and further edits diff correctly. Drop every row whose
        // saved target quantity is zero — whether it came from Remove or was
        // typed manually — so it is not resubmitted on the next Save.
        setRows((rs) =>
          rs
            .filter((r) => !r.removed && !isZeroQty(r.quantity))
            .map((r) => ({
              ...r,
              isNew: false,
              initialQuantity: r.quantity,
              initialAvgCostUsd: r.avgCostUsd,
            }))
        );
        setSave({ kind: "saved" });
        return;
      }
      if (result.ok === false) {
        setSave({ kind: "failed", errors: result.errors });
        return;
      }
      // result.ok === "unknown" — a genuinely ambiguous COMMIT. Never the
      // "nothing was saved" copy.
      setSave({ kind: "unknown", message: result.message });
    } catch {
      setSave({ kind: "unreachable" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const errors = save.kind === "failed" ? save.errors : {};
  // A rejection can carry only field-level keys (an as-of-date error, or
  // holdings.<i>.<field> row errors) with no form-level message — without this
  // summary the Save button would then have no feedback beside it, only the
  // inline errors far up the editor.
  const hasFieldErrors = Object.keys(errors).length > 0;

  // Page-level footnote for stale/unavailable holdings, matching
  // DashboardHoldingsTable's footnoteFor pattern — scoped to non-removed
  // rows only, since a removed row's price health is no longer relevant.
  const footnote =
    rows
      .filter((r) => !r.removed)
      .map((r) =>
        r.priceStatus === "stale"
          ? `${r.symbol} is priced at ${r.priceDate} close.`
          : r.priceStatus === "unavailable"
            ? `${r.symbol} has no price and is excluded from market value and P&L.`
            : null
      )
      .filter((f): f is string => f !== null)
      .join(" ") || null;

  return (
    <>
      <div className="section">
        <div className="sechead">
          <h2>Positions</h2>
          <div className="note">Alphabetical</div>
        </div>

        <div className="editor-table">
          <table className="holdings">
            <colgroup>
              <col className="c-sym" /><col className="c-type" /><col className="c-qty" /><col className="c-avg" />
              <col className="c-price" /><col className="c-mv" /><col className="c-pl" /><col className="c-act" />
            </colgroup>
            <thead>
              <tr>
                <th className="l">Symbol</th>
                <th className="l">Type</th>
                <th>Quantity</th>
                <th>Average cost</th>
                <th>Price</th>
                <th>Market value</th>
                <th>Unrealised P&amp;L</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const note = avgCostNote(r);
                const d = r.removed ? { mv: "—", pl: "—" } : derived(r);
                const qtyErr = errors[`holdings.${i}.quantity`];
                const avgErr = errors[`holdings.${i}.avgCostUsd`];
                const qtyErrId = `qty-${r.assetId}-err`;
                const avgErrId = `avg-${r.assetId}-err`;
                const noteId = `avg-${r.assetId}-note`;
                const avgDescribedBy =
                  [avgErr ? avgErrId : null, note ? noteId : null].filter(Boolean).join(" ") || undefined;
                return (
                  <tr key={r.assetId}>
                    <td className="l sym">
                      <span className="cell-label">Symbol</span>
                      {r.symbol}
                    </td>
                    <td className="l dim">
                      <span className="cell-label">Type</span>
                      {formatAssetClass(r.assetClass)}
                    </td>
                    <td>
                      <span className="cell-label">Quantity</span>
                      <input
                        id={`qty-${r.assetId}`}
                        className={`cellinput num${qtyErr ? " err" : ""}`}
                        type={hidden ? "password" : "text"}
                        autoComplete="off"
                        aria-label={`Quantity for ${r.symbol}`}
                        aria-invalid={qtyErr ? true : undefined}
                        aria-describedby={qtyErr ? qtyErrId : undefined}
                        value={r.quantity}
                        disabled={r.removed}
                        onChange={(e) => patchRow(i, { quantity: e.target.value })}
                      />
                      {qtyErr && (
                        <span id={qtyErrId} role="alert" className="rowerr">
                          {qtyErr}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="cell-label">Average cost</span>
                      <input
                        id={`avg-${r.assetId}`}
                        className={`cellinput num${avgErr ? " err" : ""}`}
                        type={hidden ? "password" : "text"}
                        autoComplete="off"
                        aria-label={`Average cost for ${r.symbol}`}
                        aria-invalid={avgErr ? true : undefined}
                        aria-describedby={avgDescribedBy}
                        value={r.avgCostUsd}
                        disabled={r.removed}
                        onChange={(e) => patchRow(i, { avgCostUsd: e.target.value })}
                      />
                      {avgErr && (
                        <span id={avgErrId} role="alert" className="rowerr">
                          {avgErr}
                        </span>
                      )}
                      {note && (
                        <div id={noteId} role="status" className="status-warning" style={{ fontSize: "0.85em" }}>
                          {note}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      <span className="cell-label">Price</span>
                      {r.removed ? (
                        "—"
                      ) : (
                        <PriceCell priceStatus={r.priceStatus} priceUsd={r.priceUsd} priceDate={r.priceDate} />
                      )}
                    </td>
                    <td className="num strong">
                      <span className="cell-label">Market value</span>
                      {d.mv === "—" ? d.mv : <MaskableValue>{d.mv}</MaskableValue>}
                    </td>
                    <td className={`num strong${
                      r.removed || d.pl === "—" ? "" : d.pl.startsWith("-") ? " loss" : " gain"
                    }`}>
                      <span className="cell-label">Unrealised P&amp;L</span>
                      {d.pl === "—" ? d.pl : <MaskableValue>{d.pl}</MaskableValue>}
                    </td>
                    <td>
                      {r.removed ? (
                        <button type="button" className="btn2" style={{ height: 30, fontSize: 13 }} onClick={() => undoRemove(i)}>
                          Undo
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="iconbare rmv"
                          aria-label={`Remove ${r.symbol}`}
                          onClick={() => removeRow(i)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {footnote && <div className="footnote">{footnote}</div>}
      </div>

      <div className="section">
        <div className="sechead">
          <h2>Add a holding</h2>
        </div>
        <fieldset className="add-holding-fieldset">
          <legend>Add a holding</legend>
          <div className="formrow">
            <div className="field">
              <label htmlFor="add-ticker">Ticker symbol</label>
              <input
                id="add-ticker"
                className="inp w150"
                aria-label="Ticker symbol"
                value={tickerInput}
                onChange={(e) => {
                  setTickerInput(e.target.value);
                  setAddError(null);
                  clearSaveState();
                  resolveSeq.current++;
                  clearResolution();
                }}
                onBlur={() => void resolveFor(tickerInput, assetType)}
              />
            </div>
            <div className="field">
              <label htmlFor="add-type">Asset type</label>
              <select
                id="add-type"
                className="inp w140"
                aria-label="Asset type"
                value={assetType}
                onChange={(e) => {
                  const next = e.target.value as AssetClass;
                  setAssetType(next);
                  setAddError(null);
                  clearSaveState();
                  if (tickerInput.trim()) {
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
            </div>
            <div className="field">
              <label htmlFor="add-qty">Quantity</label>
              <input
                id="add-qty"
                className="inp n w120"
                type={hidden ? "password" : "text"}
                autoComplete="off"
                aria-label="New holding quantity"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="add-cost">Average cost (USD)</label>
              <input
                id="add-cost"
                className="inp n w150"
                type={hidden ? "password" : "text"}
                autoComplete="off"
                aria-label="New holding average cost"
                value={addCost}
                onChange={(e) => setAddCost(e.target.value)}
              />
            </div>
            <button type="button" className="btn" onClick={addRow}>
              + Add holding
            </button>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {resolving && <span className="status-neutral">checking…</span>}
            {resolution && resolution.ok && (
              <span className="status-success">
                ✓ Resolved — last price ${resolution.priceUsd} ({resolution.priceDate})
              </span>
            )}
            {resolution && !resolution.ok && <span className="status-warning">{resolution.message}</span>}
          </div>
          {addError && <div className="status-msg status-danger">{addError}</div>}
        </fieldset>

        {errors.asOfDate && (
          <p id="as-of-date-err" role="alert" className="status-danger">
            {errors.asOfDate}
          </p>
        )}

        {save.kind === "saved" && (
          <p className="status s-ok" role="status">
            Holdings updated.
          </p>
        )}
        {save.kind === "failed" && errors.form && (
          <p className="status s-bad" role="alert">
            {errors.form}
          </p>
        )}
        {save.kind === "failed" && !errors.form && hasFieldErrors && (
          <p className="status s-bad" role="alert">
            Fix the highlighted errors before saving.
          </p>
        )}
        {save.kind === "unknown" && (
          <p className="status s-warn" role="alert">
            {save.message}
          </p>
        )}
        {save.kind === "unreachable" && (
          <p className="status s-warn" role="alert">
            We couldn&apos;t reach the server, so we don&apos;t know whether your changes saved. Check the
            Dashboard before trying again.
          </p>
        )}

        <div className="saverow">
          <div className="field">
            <label htmlFor="holdings-as-of-date">Recording as of</label>
            <input
              id="holdings-as-of-date"
              className={`inp w170${errors.asOfDate ? " err" : ""}`}
              type="date"
              aria-label="As-of date"
              aria-invalid={errors.asOfDate ? true : undefined}
              aria-describedby={errors.asOfDate ? "as-of-date-err" : undefined}
              value={asOfDate}
              max={localTodayIso()}
              onChange={(e) => {
                clearSaveState();
                setAsOfDate(e.target.value);
              }}
            />
          </div>
          <div>
            <button type="button" className="btn" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
