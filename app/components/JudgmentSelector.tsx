"use client";

import { useState } from "react";
import { recordJudgmentAction } from "@/app/actions/analyzer";
import type { JudgmentDefinition } from "@/lib/analyzer/judgments";
import type { StoredJudgment } from "@/lib/analyzer/decisions";

// §4.4, placed in Step 2 by R6. Design §152's JudgmentSelector: presents the
// options WITH their resulting figures side by side, because §4.4's own
// guidance is to examine the size of the gap between them — where two
// defensible choices produce nearly the same figure the choice barely matters,
// and where they diverge that difference travels into every number downstream.
//
// Design §198: "the human selects; the human never types a figure." These were
// text inputs with placeholder text the analyst had to remember and retype. A
// typed selection cannot be validated, and the stored column is free text by
// design — the option set differs per judgment and the spec freezes none of the
// strings — so the interface is the only place this can be constrained.

export function JudgmentSelector({
  runId,
  judgment,
  existing,
}: {
  runId: string;
  judgment: JudgmentDefinition;
  existing: StoredJudgment | undefined;
}) {
  // The recorded selection is what the control falls back to; local state holds
  // only an unsubmitted change. Same shape as the fact cards, and for the same
  // reason: a control that defaults to empty on a judgment already made shows
  // the analyst a blank where their own answer belongs.
  const [pending, setPending] = useState<string | null>(null);
  const chosen = pending ?? existing?.selection ?? null;

  const selectable = judgment.options !== null;
  // Read off the options actually rendered. Non-operating investments now has
  // as many as the filings tag, so any written-in number is wrong for some run.
  const optionCount = judgment.options?.length ?? 0;

  return (
    <div className="judgment">
      <h3>{judgment.title}</h3>
      <p className="why">{judgment.why}</p>

      <form action={recordJudgmentAction}>
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="judgmentKey" value={judgment.key} />

        {judgment.options && (
          <fieldset className="decision">
            <legend>Selection — no default</legend>
            <div className="options">
              {judgment.options.map((option) => (
                <label
                  className={`option${chosen === option.label ? " chosen" : ""}`}
                  key={option.label}
                >
                  <input
                    type="radio"
                    name={`judgment-${judgment.key}`}
                    value={option.label}
                    checked={chosen === option.label}
                    onChange={() => setPending(option.label)}
                  />
                  <span className="lab">{option.label}</span>
                  <span className="fig">{option.figure}</span>
                  {option.figureLabel && <span className="lab">{option.figureLabel}</span>}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {/* Shown so the analyst can see it was considered and refused. Not a
            control: there is nothing here to select.

            This carries suppression decoration, and that is correct — the mock
            renders it so, and the claim being made is that no choice is
            available here. It is not the §0 case the fact cards fixed, where a
            verification state sat in suppression beside a value that was
            present. Do not "correct" it. */}
        {judgment.excluded && (
          <div className="options excluded-row">
            <div className="option excluded">
              <span className="lab">{judgment.excluded.label}</span>
              <span className="fig">{judgment.excluded.figure}</span>
              <span className="note">{judgment.excluded.note}</span>
            </div>
          </div>
        )}

        {/* Where the options are not enumerable, the gap is stated rather than
            papered over with a control that pretends to be the same thing. The
            section head still says SELECT, DO NOT TYPE, which is true of the
            judgments that can be selected; weakening it to fit this one would
            soften a correct rule to accommodate a gap. */}
        {judgment.gap && (
          <>
            <p className="note">{judgment.gap}</p>
            <label className="fieldlabel" htmlFor={`sel-${judgment.key}`}>
              Classification
            </label>
            <input
              className="inset"
              id={`sel-${judgment.key}`}
              name="selection"
              defaultValue={existing?.selection ?? ""}
            />
          </>
        )}

        {/* The selected option travels under the name the server action reads,
            independent of how the controls above are grouped. */}
        {selectable && <input type="hidden" name="selection" value={chosen ?? ""} />}

        <div style={{ height: 16 }} />
        <label className="fieldlabel" htmlFor={`reason-${judgment.key}`}>
          Reason
        </label>
        <input
          className="inset"
          id={`reason-${judgment.key}`}
          name="reason"
          defaultValue={existing?.reason ?? ""}
        />

        <div className="continue">
          <button className="act" type="submit" disabled={selectable && chosen === null}>
            {existing ? "Update judgment" : "Record judgment"}
          </button>
          {selectable && chosen === null && (
            <span className="reason">
              {/* Derived, never written. This said "the two options" on every
                  judgment, which went wrong the moment non-operating
                  investments got its real options from acquisition — a count
                  hard-coded against fixture content, on the judgment this
                  milestone existed to complete. */}
              Nothing is selected. The {optionCount} options produce different figures, and the one
              you pick travels into every number downstream.
            </span>
          )}
          {existing && (
            <span className="reason">
              Recorded. Selection and reason are printed in report section J.
            </span>
          )}
        </div>
      </form>

      {judgment.note && <p className="note">{judgment.note}</p>}
    </div>
  );
}
