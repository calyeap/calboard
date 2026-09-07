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
  // `pending` is the analyst's unsubmitted change on this render; the recorded
  // decision is what the card falls back to. Deriving `chosen` this way is what
  // stops the card asserting two states at once.
  //
  // It previously defaulted to null even for a fact that HAD been decided, so a
  // confirmed card showed its CONFIRMED token and .decided block beside an
  // empty fieldset, a disabled button and the words "Neither option is
  // selected" — confirmed twice and unconfirmed twice, on the one screen whose
  // purpose is verification. Same root as the verification-state find: a
  // default read in place of the derived value.
  //
  // §3.8.3 forbids a DEFAULT for a fact nobody has decided, and that still
  // holds below — an undecided card pre-selects nothing. Showing an analyst the
  // decision they themselves recorded is the record, not a default.
  const [pending, setPending] = useState<"CONFIRMED" | "NOT CONFIRMED" | null>(null);
  const chosen = pending ?? decision?.decision ?? null;
  const setChosen = setPending;
  const citation = citationFor(fact);

  // Read, not re-derived. loadGateState has already replaced the fixture's
  // acquisition-time label with the state this run gives the fact, so the card,
  // the Analysis Result and the report all show the same thing. This component
  // used to derive it locally, which is why the screen could read SPOT-CHECK
  // PENDING while the record underneath still said VERIFIED.
  const verificationState = fact.verificationState;

  // §4.3 — absence is displayed, never rendered as zero. A card with no value
  // is the only case where suppression decoration is correct, because
  // suppression is the claim that there is no number here.
  const valuePresent = fact.value !== null;

  // What this card says about its own state, or null where the state line adds
  // nothing the token stamp has not already said.
  const stateLine = !queued
    ? {
        name: "Spot-check not required",
        cause:
          "Acquired through a fixed, versioned tag mapping, so it is not spot-checked. It is not hidden either, and it carries every label it would otherwise carry.",
      }
    : decision
      ? {
          name: decision.decision === "CONFIRMED" ? "Confirmed" : "Cannot verify",
          cause: decision.reasonCode
            ? `${decision.reasonCode} · dependent outputs return INCOMPLETE`
            : "Counts toward spot-check completion",
        }
      : null;

  return (
    <div className="factcard">
      <div>
        <h3 className="factname">{fact.name}</h3>
        <p className="requiredfor">
          {queued && !decision ? "Queued for spot-check · " : queued ? "" : "Shown, not queued · "}
          {fact.type}
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

        {/* Design §0 — the decoration belongs to the CELL, not to the state.
            Suppression (tint plus the 2px ink rule) means there is no value
            here; qualification sits beside a value that is present and says
            something about it.

            So the treatment is chosen by whether this card has a value, and
            never by which verification state it happens to be in. Written this
            way deliberately: the previous version applied §0 to a list of state
            names, which is why SPOT-CHECK NOT REQUIRED was corrected and
            CONFIRMED kept its suppression block. A rule keyed on the value
            cannot go out of date when a state is added. */}
        {stateLine && (
          <div className={valuePresent ? "qualifier" : "state"}>
            <span className="name">{stateLine.name}</span>
            <span className="cause">{stateLine.cause}</span>
          </div>
        )}

        {queued && (
          <form action={recordFactDecisionAction}>
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="factId" value={fact.id} />
            {/* What is actually posted. The radios below are grouped per card
                and carry per-card names, so this hidden field keeps the server
                action's contract — it reads formData.get("decision") — stable
                and independent of how the controls are grouped. */}
            <input type="hidden" name="decision" value={chosen ?? ""} />

            {/* Exactly two decisions, neither pre-selected, no third control,
                and no control that edits a figure (§3.8.3).

                The group name is per-card. It was "decision" on every card,
                which left the cards apart only because each happens to sit in
                its own <form> — browsers and React both scope radio grouping by
                form owner. Grouping that depends on an enclosing element rather
                than on the control's own identity is one refactor from
                collapsing, and when it collapses a click on one fact moves
                another fact's radio: a decision recorded that nobody made,
                which is the failure Step 2 exists to prevent. */}
            <fieldset className="decision">
              <legend>Decision — no default</legend>
              <div className="choices">
                <label className="choice">
                  <input
                    type="radio"
                    name={`decision-${fact.id}`}
                    value="CONFIRMED"
                    checked={chosen === "CONFIRMED"}
                    onChange={() => setChosen("CONFIRMED")}
                  />{" "}
                  Confirm against source
                </label>
                <label className="choice">
                  <input
                    type="radio"
                    name={`decision-${fact.id}`}
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
                <select
                  id={`reason-${fact.id}`}
                  name="reasonCode"
                  // The recorded code, so a decided card shows what was chosen
                  // rather than re-asking a question already answered.
                  defaultValue={decision?.reasonCode ?? ""}
                  required
                >
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
