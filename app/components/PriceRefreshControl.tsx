"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { refreshAllPricesAction } from "@/app/actions/prices";

// The Dashboard's ONE manual refresh control (spec: never automatic, never
// interval-based). Most clicks change nothing — EOD data updates once a day
// — so an explicit "Up to date" / "Updated" state is required: silence
// after a click reads as broken, not as "nothing to do".
export function PriceRefreshControl({
  checkedAt,
  label,
}: {
  checkedAt?: string;
  // Overrides the default "Data checked {checkedAt}" text — /holdings uses
  // this to merge its own price-date line into the same checked row instead
  // of stacking two freshness lines.
  label?: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "pending" }
    | { kind: "done"; changed: boolean; message?: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleRefresh() {
    setState({ kind: "pending" });
    const result = await refreshAllPricesAction();
    if (!result.ok) {
      setState({ kind: "error", message: result.message ?? "Price refresh failed." });
      return;
    }
    setState({ kind: "done", changed: result.changed, message: result.message });
    router.refresh();
  }

  return (
    <div className="checked">
      {label ?? `Data checked ${checkedAt}`}
      <button
        type="button"
        className="refresh"
        aria-label="Refresh prices"
        title="Refresh prices"
        onClick={handleRefresh}
        disabled={state.kind === "pending"}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.6-6.4" />
          <path d="M21 4v5h-5" />
        </svg>
      </button>
      {state.kind === "done" && (
        <span role="status" className="refresh-status">
          {" "}
          {state.changed ? "Updated" : "Up to date"}
        </span>
      )}
      {state.kind === "done" && state.message && (
        <span className="refresh-status status-warning"> {state.message}</span>
      )}
      {state.kind === "error" && (
        <span role="alert" className="refresh-status status-danger">
          {" "}
          {state.message}
        </span>
      )}
    </div>
  );
}
