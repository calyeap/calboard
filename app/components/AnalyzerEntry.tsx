"use client";

import { useActionState, useRef } from "react";
import { resolveTickerAction, beginAnalysisAction } from "@/app/actions/analyzer";
import { EMPTY_RESOLVE_STATE } from "@/lib/analyzer/resolveState";
import { disabledReason, offersTryAgain } from "@/lib/analyzer/identity";

// Screen 1 — Step 1, ticker entry and identity resolution.
// Rendered per mock-screen1-entry.html. Four outcomes, one field, no Resolve
// button: resolution fires on blur or Enter.

export function AnalyzerEntry({ fixtureMissing }: { fixtureMissing?: string }) {
  const [state, formAction] = useActionState(resolveTickerAction, EMPTY_RESOLVE_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  const identity = state.identity;

  return (
    <div className="cb-steps">
      <div className="wrap">
        <div className="entrycol">
          <div className="sechead">
            <h2>Step 1 — Ticker entry and identity resolution</h2>
            <span className="screenlabel">Human · one field</span>
          </div>
          <hr className="rule" />

          <p className="whythisfact">
            One field, one ticker. Before any data is fetched, the provider is asked a single
            question — what instrument is this? Identity is settled first, on its own, because
            every step after this one reads filings, and an instrument with no filings has nothing
            for them to read.
          </p>

          {/* Resolution fires on blur or Enter. There is deliberately no
              Resolve button: a second control would imply the analyst can
              proceed without one, and the run commits on Begin analysis. */}
          <form ref={formRef} action={formAction}>
            <div className="entryfield" style={{ marginTop: 28 }}>
              <label htmlFor="ticker">Ticker</label>
              <div className="tickerrow">
                <input
                  className="inset ticker"
                  id="ticker"
                  name="ticker"
                  type="text"
                  defaultValue={state.entered}
                  autoComplete="off"
                  spellCheck={false}
                  onBlur={() => formRef.current?.requestSubmit()}
                />
              </div>
            </div>
          </form>

          <p className="helpline">
            A US-listed operating company, one per run. ETFs and other funds are out of scope
            here — they have no filings of their own.
          </p>

          {fixtureMissing && (
            <div className="result">
              <div className="state">
                <span className="plain">
                  {fixtureMissing} resolves as a listed operating company, but this build has no
                  fact set for it.
                </span>
                <span className="name">Unavailable — no fact set in this build</span>
                <span className="cause">
                  Fact acquisition arrives at milestone M8. Until then the analyzer runs the two
                  validation fixtures, MSFT and OKLO.
                </span>
              </div>
              <p className="note">
                No run was created. A run that cannot be spot-checked must not exist, because
                Step 2 is what every calculation after it depends on.
              </p>
            </div>
          )}

          {identity && identity.outcome === "RESOLVED" && (
            <div className="result">
              <div className="idcard">
                <p className="idkicker">{identity.ticker} resolved to</p>
                <h3 className="idname">{identity.companyName}</h3>
                <p className="idline">Listed operating company · reporting in USD</p>
                <div className="stamp">
                  <span>Secondary</span>
                  <span className="sep">·</span>
                  <span>Deterministic/structured</span>
                  <span className="sep">·</span>
                  <span>Resolved</span>
                </div>

                <div className="idsource">
                  <h4>Resolution</h4>
                  <dl>
                    <dt>Provider</dt>
                    <dd>Market-data provider, instrument lookup</dd>
                    <dt>Instrument type</dt>
                    <dd>EQUITY — supported</dd>
                    <dt>Symbol queried</dt>
                    <dd>{identity.ticker}, exactly as typed</dd>
                  </dl>
                </div>
              </div>

              {/* §2: no price renders on Step 1. */}
              <p className="note">
                No price appears on this screen. Identity is one question and today&rsquo;s market
                data is another; putting a number here would answer the second before the first
                has been acted on.
              </p>

              {/* Step 1 does not auto-advance. The run commits here. */}
              <form action={beginAnalysisAction}>
                <input type="hidden" name="ticker" value={identity.ticker} />
                <div className="continue">
                  <button className="act" type="submit">
                    Begin analysis
                  </button>
                  <span className="reason">
                    Next is fact acquisition, then you check every material fact against its
                    source, one at a time. That step cannot be skipped or approved in bulk.
                  </span>
                </div>
              </form>
            </div>
          )}

          {identity && identity.outcome !== "RESOLVED" && (
            <div className="result">
              {/* UNAVAILABLE is OPEN — no answer yet. The two rejections are
                  SUPPRESSION — a settled answer, and the answer is no run. */}
              <div className={offersTryAgain(identity) ? "open" : "state"}>
                <span className="plain">{plainFor(identity.outcome, identity.ticker)}</span>
                <span className="name">{stateNameFor(identity)}</span>
                <span className="cause">{causeFor(identity.outcome)}</span>
              </div>

              <p className="note">{noteFor(identity.outcome)}</p>

              <div className="continue">
                {offersTryAgain(identity) && (
                  <button
                    className="act"
                    type="button"
                    onClick={() => formRef.current?.requestSubmit()}
                  >
                    Try again
                  </button>
                )}
                <button className="act" type="button" disabled>
                  Begin analysis
                </button>
                <span className="reason">{disabledReason(identity)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function stateNameFor(identity: { outcome: string; ticker: string }): string {
  switch (identity.outcome) {
    case "UNKNOWN":
      return `Unknown — no provider evidence for ${identity.ticker}`;
    case "UNSUPPORTED":
      return "Unsupported — not an operating company";
    default:
      return "Unavailable — provider not reached";
  }
}

function plainFor(outcome: string, ticker: string): string {
  switch (outcome) {
    case "UNKNOWN":
      return "The provider answered, and has no instrument under this symbol.";
    case "UNSUPPORTED":
      return "This is a real instrument. It is not one this analyzer can run.";
    default:
      return `We could not reach the provider. This says nothing about whether ${ticker} exists.`;
  }
}

function causeFor(outcome: string): string {
  switch (outcome) {
    case "UNKNOWN":
      return "Provider responded normally · zero matches returned";
    case "UNSUPPORTED":
      return "Analyzer accepts listed operating companies only";
    default:
      return "The request to the identity service did not complete";
  }
}

function noteFor(outcome: string): string {
  switch (outcome) {
    case "UNKNOWN":
      return "Check the spelling and type it again. A symbol that does not resolve cannot start a run, and there is no way to continue with one that did not.";
    case "UNSUPPORTED":
      return "A fund has no filings of its own, and every step after this one reads filings — so there would be nothing to spot-check and nothing to value. This is about the instrument type, not the business.";
    default:
      return "Nothing has been rejected and nothing has been recorded. Your entry is still in the field. Try again now or later — a failure to reach the provider is never treated as evidence about a symbol.";
  }
}
