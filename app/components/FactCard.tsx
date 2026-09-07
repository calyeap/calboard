"use client";

import { useState } from "react";
import { recordFactDecisionAction } from "@/app/actions/analyzer";
import { citationFor } from "@/lib/analyzer/citation";
import { REASON_CODES, type StoredFactDecision } from "@/lib/analyzer/decisions";
import type { FactRecord } from "@/lib/analyzer/types";

// One fact at a time, full width, with its source beside it. Not a table:
// "table review is what produces click-through, because a table invites you to
// scan the shape rather than read the value" (design §176).

export function FactCard({
  runId,
  fact,
  decision,
  queued,
}: {
  runId: string;
  fact: FactRecord;
  decision: StoredFactDecision | undefined;
  queued: boolean;
}) {
  // Nothing is pre-selected — not on first render, and not from a previous
  // decision either. Re-opening a decided fact re-asks the question rather
  // than presenting an answer to accept.
  const [chosen, setChosen] = useState<"CONFIRMED" | "NOT CONFIRMED" | null>(null);
  const citation = citationFor(fact);

  // Derived once and used in both the provenance stamp and the source pane.
  // The fixtures carry verificationState VERIFIED on every record, which is
  // true of their acquisition but says nothing about this run's spot-check —
  // rendering it on an undecided queued fact would claim the analyst had
  // verified a figure they have not yet looked at, which is the opposite of
  // what Step 2 is for. The run's own state wins over the fact's.
  const verificationState = decision
    ? decision.decision
    : queued
      ? "SPOT-CHECK PENDING"
      : "SPOT-CHECK NOT REQUIRED";

  return (
    <div className="factcard">
      <div>
        <h3 className="factname">{fact.name}</h3>
        <p className="requiredfor">
          {queued ? "Queued for spot-check" : "Shown, not queued"} · {fact.type}
        </p>

        <p className="periodline">
          This is the {fact.asOfDate} figure
          {fact.retrievalTimestamp ? `, retrieved ${formatStamp(fact.retrievalTimestamp)}` : ""}.
        </p>
        <div className="value">{renderValue(fact.value)}</div>

        {/* Three fixed slots, in fixed order, never merged (§3.2.1). */}
        <div className="stamp">
          <span>{titleCase(fact.sourceClass)}</span>
          <span className="sep">·</span>
          <span className={fact.extractionType === "AI-EXTRACTED" ? "ai" : undefined}>
            {titleCase(fact.extractionType)}
          </span>
          <span className="sep">·</span>
          <span>{titleCase(verificationState)}</span>
        </div>

        {!queued && (
          <div className="decided">
            <span className="name">Spot-check not required</span>
            <span className="cause">
              Acquired through a fixed, versioned tag mapping (§3.8.1). It is not spot-checked; it
              is not hidden, and it carries every label it would otherwise carry.
            </span>
          </div>
        )}

        {queued && decision && (
          <div className="decided">
            <span className="name">
              {decision.decision === "CONFIRMED" ? "Confirmed" : "Cannot verify"}
            </span>
            <span className="cause">
              {decision.reasonCode
                ? `${decision.reasonCode} · dependent outputs return INCOMPLETE (§5)`
                : "Counts toward spot-check completion"}
            </span>
          </div>
        )}

        {queued && (
          <form action={recordFactDecisionAction}>
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="factId" value={fact.id} />

            {/* Exactly two decisions, neither pre-selected, no third control,
                and no control that edits a figure (§3.8.3). */}
            <fieldset className="decision">
              <legend>Decision — no default</legend>
              <div className="choices">
                <label className="choice">
                  <input
                    type="radio"
                    name="decision"
                    value="CONFIRMED"
                    checked={chosen === "CONFIRMED"}
                    onChange={() => setChosen("CONFIRMED")}
                  />{" "}
                  Confirm against source
                </label>
                <label className="choice">
                  <input
                    type="radio"
                    name="decision"
                    value="NOT CONFIRMED"
                    checked={chosen === "NOT CONFIRMED"}
                    onChange={() => setChosen("NOT CONFIRMED")}
                  />{" "}
                  Cannot verify
                </label>
              </div>
            </fieldset>

            {/* §3.8.4 — a fixed two-option select, required, no free text and
                no "other". The mock is silent on this control, so the spec
                governs. `required` makes the browser refuse the submit; the
                server and the database refuse it independently. */}
            {chosen === "NOT CONFIRMED" && (
              <div className="reasoncode">
                <label htmlFor={`reason-${fact.id}`}>Reason — required</label>
                <select id={`reason-${fact.id}`} name="reasonCode" defaultValue="" required>
                  <option value="" disabled>
                    Select a reason
                  </option>
                  {REASON_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="continue">
              <button className="act" type="submit" disabled={chosen === null}>
                {decision ? "Change decision" : "Record decision"}
              </button>
              {chosen === null && (
                <span className="reason">
                  Neither option is selected. Both count toward completing Step 2; Cannot verify
                  returns INCOMPLETE for anything computed from this figure.
                </span>
              )}
            </div>
          </form>
        )}
      </div>

      <div className="sourcepane">
        <h4>Source</h4>
        <dl>
          <dt>Document</dt>
          <dd>
            {citation.url ? (
              <a href={citation.url}>{citation.label}</a>
            ) : (
              <span className="nolink">{citation.label}</span>
            )}
          </dd>
          {citation.unavailableReason && (
            <>
              <dt>Direct link</dt>
              <dd className="nolink">{citation.unavailableReason}</dd>
            </>
          )}
          <dt>Source class</dt>
          <dd>{fact.sourceClass}</dd>
          <dt>Extraction type</dt>
          <dd>{fact.extractionType}</dd>
          <dt>Verification state</dt>
          <dd>{verificationState}</dd>
          <dt>As-of / period</dt>
          <dd>{fact.asOfDate}</dd>
          <dt>Retrieval timestamp</dt>
          <dd>{fact.retrievalTimestamp ? formatStamp(fact.retrievalTimestamp) : "—"}</dd>
        </dl>
      </div>
    </div>
  );
}

function renderValue(value: FactRecord["value"]): string {
  // Absence is displayed, never rendered as zero (§4.3).
  if (value === null) return "—";
  return String(value);
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function formatStamp(iso: string): string {
  return iso.replace("T", " ").replace(/(-|\+)\d{2}:\d{2}$/, "");
}
