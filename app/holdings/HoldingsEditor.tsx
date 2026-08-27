"use client";

import { useRef, useState } from "react";
import Decimal from "decimal.js";
import { localTodayIso } from "@/lib/dateValidation";
import type { AssetClass } from "@/lib/assets";
import type { PriceStatus } from "@/lib/portfolio";
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
  marketValueUsd: string | null;
  unrealisedPlUsd: string | null;
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
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [asOfDate, setAsOfDate] = useState(localTodayIso());
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  // Add-a-holding draft row — mirrors the wizard's Step 1 resolver + the
  // resolved-ticker staleness guard.
  const [tickerInput, setTickerInput] = useState("");
  const [assetType, setAssetType] = useState<AssetClass>("equity");
  const [addQty, setAddQty] = useState("");
  const [addCost, setAddCost] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState<TickerResolutionResult | null>(null);
  const [resolvedTicker, setResolvedTicker] = useState<string | null>(null);
  const [draftAssetId, setDraftAssetId] = useState<string | null>(null);

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

  function addRow() {
    setAddError(null);
    const normalized = tickerInput.trim().toUpperCase();
    if (!normalized) {
      setAddError("Enter a ticker symbol.");
      return;
    }
    // Staleness guard: the current identity must have been resolved for
    // exactly this normalized symbol.
    if (!draftAssetId || resolvedTicker !== normalized) {
      setAddError("Resolve the ticker first — enter it and tab out, or press Add anyway.");
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
        marketValueUsd: null,
        unrealisedPlUsd: null,
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
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setRows((rs) => {
      const target = rs[i];
      if (target.isNew) return rs.filter((_, idx) => idx !== i);
      return rs.map((r, idx) => (idx === i ? { ...r, removed: true, quantity: "0" } : r));
    });
  }

  function undoRemove(i: number) {
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
      const holdings = rows.map((r) => ({
        assetId: r.assetId,
        quantity: r.removed ? "0" : r.quantity,
        avgCostUsd: r.avgCostUsd,
      }));
      const result = await updateHoldingsAction({ asOfDate, holdings });
      if (result.ok === true) {
        // Rebase the baseline to the saved values so the avg-cost note
        // clears and further edits diff correctly; drop removed rows.
        setRows((rs) =>
          rs
            .filter((r) => !r.removed)
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

  return (
    <div style={{ fontFamily: "system-ui" }}>
      <p style={{ color: "#555" }}>
        Edit the quantities and average costs to match what you hold now, then Save.
      </p>

      <p style={{ color: "#555" }}>
        As of {asOfDate}.{" "}
        {!datePickerOpen && (
          <button type="button" onClick={() => setDatePickerOpen(true)}>
            Change date
          </button>
        )}
      </p>
      {datePickerOpen && (
        <p>
          <label htmlFor="holdings-as-of-date">As of </label>
          <input
            id="holdings-as-of-date"
            type="date"
            aria-label="As-of date"
            value={asOfDate}
            max={localTodayIso()}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
        </p>
      )}
      {errors.asOfDate && <p style={{ color: "#b00020" }}>{errors.asOfDate}</p>}

      <table border={1} cellPadding={6} style={{ borderCollapse: "collapse", marginTop: "0.5rem" }}>
        <thead>
          <tr>
            <th>Symbol</th>
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
            return (
              <tr key={r.assetId} style={r.removed ? { opacity: 0.5 } : undefined}>
                <td>{r.symbol}</td>
                <td>
                  <input
                    aria-label={`Quantity for ${r.symbol}`}
                    value={r.quantity}
                    disabled={r.removed}
                    onChange={(e) => patchRow(i, { quantity: e.target.value })}
                  />
                  {errors[`holdings.${i}.quantity`] && (
                    <div style={{ color: "#b00020" }}>{errors[`holdings.${i}.quantity`]}</div>
                  )}
                </td>
                <td>
                  <input
                    aria-label={`Average cost for ${r.symbol}`}
                    value={r.avgCostUsd}
                    disabled={r.removed}
                    onChange={(e) => patchRow(i, { avgCostUsd: e.target.value })}
                  />
                  {errors[`holdings.${i}.avgCostUsd`] && (
                    <div style={{ color: "#b00020" }}>{errors[`holdings.${i}.avgCostUsd`]}</div>
                  )}
                  {note && <div style={{ color: "#a15c00", fontSize: "0.85em" }}>{note}</div>}
                </td>
                <td>{r.priceUsd ? `$${r.priceUsd}` : "—"}</td>
                <td>{r.marketValueUsd ?? "—"}</td>
                <td>{r.unrealisedPlUsd ?? "—"}</td>
                <td>
                  {r.removed ? (
                    <button type="button" onClick={() => undoRemove(i)}>
                      Undo
                    </button>
                  ) : (
                    <button type="button" aria-label={`Remove ${r.symbol}`} onClick={() => removeRow(i)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <fieldset style={{ marginTop: "1rem", maxWidth: 380 }}>
        <legend>Add a holding</legend>
        <div style={{ display: "grid", gap: "0.5rem" }}>
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
          {resolution && resolution.ok && (
            <span>
              ✓ Resolved — last price ${resolution.priceUsd} ({resolution.priceDate})
            </span>
          )}
          {resolution && !resolution.ok && (
            <span>
              {resolution.message}{" "}
              {draftAssetId && (
                <button type="button" onClick={addRow}>
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
            <input
              aria-label="New holding quantity"
              value={addQty}
              onChange={(e) => setAddQty(e.target.value)}
            />
          </label>

          <label>
            Average cost (USD)
            <br />
            <input
              aria-label="New holding average cost"
              value={addCost}
              onChange={(e) => setAddCost(e.target.value)}
            />
          </label>

          <button type="button" onClick={addRow}>
            + Add holding
          </button>
          {addError && <span style={{ color: "#b00020" }}>{addError}</span>}
        </div>
      </fieldset>

      {save.kind === "saved" && <p style={{ color: "#0a7a0a" }}>Holdings updated.</p>}
      {save.kind === "failed" && errors.form && (
        <p style={{ color: "#b00020" }} role="alert">
          {errors.form}
        </p>
      )}
      {save.kind === "unknown" && (
        <p style={{ color: "#a15c00" }} role="alert">
          {save.message}
        </p>
      )}
      {save.kind === "unreachable" && (
        <p style={{ color: "#a15c00" }} role="alert">
          We couldn&apos;t reach the server, so we don&apos;t know whether your changes saved. Check the
          Dashboard before trying again.
        </p>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        <button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
