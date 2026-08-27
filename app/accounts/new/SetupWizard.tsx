"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { localTodayIso } from "@/lib/dateValidation";

type Step = 1 | 2 | "complete";

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

  // Disposable draft: nothing is persisted before Save. The only content a
  // user can have entered in this slice is a changed as-of date.
  const hasEnteredContent = asOfDate !== localTodayIso();

  function handleCancel() {
    if (hasEnteredContent && !window.confirm("Discard this setup? Nothing has been saved yet.")) {
      return;
    }
    router.push("/holdings");
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
    </div>
  );
}
