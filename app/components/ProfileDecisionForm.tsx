"use client";

import { useState } from "react";
import { recordProfileDecisionAction } from "@/app/actions/analyzer";

// Step 6 — profile confirmation (§6.3).
//
// Three outcomes, none pre-selected, as radios in one fieldset legended
// "Decision — no default" — the same mechanism as Step 2, so the two human
// decisions in this flow do not look like different kinds of question.

const PROFILES = [
  "Mature, profitable, stable FCF",
  "High-growth, profitable, uncertain durability",
  "Pre-revenue / unprofitable",
];

export function ProfileDecisionForm({
  runId,
  recommendedLabel,
}: {
  runId: string;
  recommendedLabel: string;
}) {
  const [chosen, setChosen] = useState<"CONFIRMED" | "OVERRIDDEN" | "CANNOT JUDGE" | null>(null);

  return (
    <form action={recordProfileDecisionAction}>
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="recommendedProfile" value={recommendedLabel} />

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
            Confirm recommended profile
          </label>
          <label className="choice">
            <input
              type="radio"
              name="decision"
              value="OVERRIDDEN"
              checked={chosen === "OVERRIDDEN"}
              onChange={() => setChosen("OVERRIDDEN")}
            />{" "}
            Override
          </label>
          <label className="choice">
            <input
              type="radio"
              name="decision"
              value="CANNOT JUDGE"
              checked={chosen === "CANNOT JUDGE"}
              onChange={() => setChosen("CANNOT JUDGE")}
            />{" "}
            Cannot judge
          </label>
        </div>
      </fieldset>

      {chosen === "OVERRIDDEN" && (
        <div className="overrideblock">
          <h4>Override</h4>
          <label className="fieldlabel" htmlFor="overrideProfile">
            Profile
          </label>
          <select className="inset" id="overrideProfile" name="overrideProfile" defaultValue="">
            <option value="" disabled>
              Select the profile that describes this company
            </option>
            {PROFILES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <div style={{ height: 20 }} />

          {/* Free text, deliberately: §6.3 makes the override reason free
              because an override is a one-off judgment nobody will count —
              the exact opposite of §3.8.4's coded fact reasons. */}
          <label className="fieldlabel" htmlFor="overrideReason">
            Reason — required, cannot be empty
          </label>
          <input
            className="inset"
            id="overrideReason"
            name="overrideReason"
            placeholder="Why this profile rather than the recommendation"
            required
          />

          <div className="ack">
            <span className="name">Recorded with the analysis</span>
            <p>
              Nothing under an overridden gate has been validated. This override, its reason and
              this statement are reproduced in the report above every number, and beside the gate
              they overrode. They are not written to a hidden log.
            </p>
          </div>
        </div>
      )}

      {chosen === "CANNOT JUDGE" && (
        <div className="ack" style={{ marginTop: 24 }}>
          <span className="name">What Cannot judge does</span>
          <p>
            The recommended profile is used provisionally so the run continues. The profile is
            recorded as <b>not human-confirmed</b>, the flag PROFILE NOT CONFIRMED is raised, trust
            status falls to PARTIAL, and the fair-value range still renders. The valuation position
            and its action clause do not — their slot shows the state instead. Cannot judge never
            counts as confirmation, and it records no reason.
          </p>
        </div>
      )}

      <div className="continue">
        <button className="act" type="submit" disabled={chosen === null}>
          Record decision and continue
        </button>
        {chosen === null && (
          <span className="reason">
            None of the three is selected. The profile selects the primary valuation method, so
            this is not a question the software may answer on your behalf.
          </span>
        )}
      </div>
    </form>
  );
}
