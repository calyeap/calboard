// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { MSFT_FIXTURE } from "@/lib/analyzer/fixtures/msft";
import { queuedFacts } from "@/lib/analyzer/spotCheck";
import type { StoredFactDecision } from "@/lib/analyzer/decisions";

// The server action reaches lib/db and therefore `pg`, which must not load
// into a jsdom test. Only the form's `action` prop references it.
vi.mock("@/app/actions/analyzer", () => ({
  recordFactDecisionAction: vi.fn(),
}));

const { FactCard } = await import("./FactCard");

afterEach(cleanup);

const QUEUED = queuedFacts(MSFT_FIXTURE.facts);
const RUN_ID = "11111111-1111-4111-8111-111111111111";

function renderQueue() {
  return render(
    <>
      {QUEUED.map((fact) => (
        <FactCard key={fact.id} runId={RUN_ID} fact={fact} decision={undefined} queued />
      ))}
    </>
  );
}

/** The card element for a fact, located by its visible name. */
function cardFor(factName: string): HTMLElement {
  const heading = screen.getByText(factName);
  const card = heading.closest(".factcard");
  if (!card) throw new Error(`No .factcard around "${factName}"`);
  return card as HTMLElement;
}

describe("Step 2 fact cards hold independent decisions", () => {
  it("has more than one queued fact to test independence with", () => {
    // Guards the rest of this file: an independence test over a single card
    // proves nothing, and would pass silently if the fixture ever shrank.
    expect(QUEUED.length).toBeGreaterThan(1);
  });

  // The defect: every card rendered its radios with name="decision", so the
  // cards' radios were only kept apart by each card happening to sit in its
  // own <form>. Grouping that depends on an enclosing element rather than on
  // the control's own identity is one refactor away from collapsing — and if
  // it collapses, a click on fact 3 moves fact 7's radio and a decision gets
  // recorded that nobody made. That is a fake confirmation entering through
  // the interface, which is the failure Step 2 exists to prevent.
  it("gives every card its own radio group name, not a shared one", () => {
    renderQueue();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const names = radios.map((r) => r.name);
    const uniqueNames = new Set(names);

    // One group per card, not one group for the screen.
    expect(uniqueNames.size).toBe(QUEUED.length);
    for (const fact of QUEUED) {
      expect(names.some((n) => n.includes(fact.id))).toBe(true);
    }
  });

  it("does not move a second card's radio when the first is chosen", () => {
    renderQueue();
    const first = cardFor(QUEUED[0].name);
    const second = cardFor(QUEUED[1].name);

    fireEvent.click(within(first).getByLabelText(/Cannot verify/));

    const firstRadios = within(first).getAllByRole("radio") as HTMLInputElement[];
    const secondRadios = within(second).getAllByRole("radio") as HTMLInputElement[];

    expect(firstRadios.some((r) => r.checked)).toBe(true);
    expect(secondRadios.every((r) => !r.checked)).toBe(true);
  });

  // The visible consequence Calvin saw: both cards showing REASON — REQUIRED
  // when only one was clicked.
  it("reveals the reason select on the chosen card only", () => {
    renderQueue();
    const first = cardFor(QUEUED[0].name);
    const second = cardFor(QUEUED[1].name);

    fireEvent.click(within(first).getByLabelText(/Cannot verify/));

    expect(within(first).queryByLabelText(/Reason — required/)).not.toBeNull();
    expect(within(second).queryByLabelText(/Reason — required/)).toBeNull();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("lets two cards hold different decisions at the same time", () => {
    renderQueue();
    const first = cardFor(QUEUED[0].name);
    const second = cardFor(QUEUED[1].name);

    fireEvent.click(within(first).getByLabelText(/Confirm against source/));
    fireEvent.click(within(second).getByLabelText(/Cannot verify/));

    const firstChecked = (within(first).getAllByRole("radio") as HTMLInputElement[]).find(
      (r) => r.checked
    );
    const secondChecked = (within(second).getAllByRole("radio") as HTMLInputElement[]).find(
      (r) => r.checked
    );

    expect(firstChecked?.value).toBe("CONFIRMED");
    expect(secondChecked?.value).toBe("NOT CONFIRMED");
    // Only the Cannot verify card asks for a reason.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("keeps each card's submit button gated on that card's own selection", () => {
    renderQueue();
    const first = cardFor(QUEUED[0].name);
    const second = cardFor(QUEUED[1].name);

    expect(within(first).getByRole("button").hasAttribute("disabled")).toBe(true);
    expect(within(second).getByRole("button").hasAttribute("disabled")).toBe(true);

    fireEvent.click(within(first).getByLabelText(/Confirm against source/));

    expect(within(first).getByRole("button").hasAttribute("disabled")).toBe(false);
    // Choosing on one card must not enable another card's submit.
    expect(within(second).getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  // -------------------------------------------------------------------
  // A card must assert ONE state. It used to assert two: a decided fact
  // rendered its CONFIRMED token and .decided block, and beside them a
  // fieldset with nothing checked, a disabled button and the words
  // "Neither option is selected". Confirmed twice, unconfirmed twice, on the
  // one screen whose purpose is verification — a reader glancing at it comes
  // away believing the fact was checked, or that it was not, depending which
  // half they read.
  //
  // The root was the same shape as the verification-state find: `chosen`
  // defaulted to null instead of deriving from the recorded decision.
  // -------------------------------------------------------------------
  describe("a decided card asserts its decision and nothing else", () => {
    const DECIDED: StoredFactDecision = {
      factId: QUEUED[0].id,
      decision: "CONFIRMED",
      reasonCode: null,
    };

    function renderDecided(decision: StoredFactDecision = DECIDED) {
      // The record carries the state the run derived, as loadGateState leaves it.
      const fact = { ...QUEUED[0], verificationState: decision.decision };
      return render(<FactCard runId={RUN_ID} fact={fact} decision={decision} queued />);
    }

    it("does not show a decision state and a live no-decision control at once", () => {
      const { container } = renderDecided();

      // The decision is shown, in the block that exists to show it. Scoped to
      // .decided deliberately: "Cannot verify" is also a radio label and
      // "Confirmed" also appears in the provenance stamp, so a bare text query
      // would measure the query rather than the card.
      expect(container.querySelector(".decided")?.textContent).toMatch(/Confirmed/);

      // ...so the card must NOT simultaneously claim nothing is selected.
      expect(screen.queryByText(/Neither option is selected/)).toBeNull();

      const radios = screen.getAllByRole("radio") as HTMLInputElement[];
      expect(radios.some((r) => r.checked)).toBe(true);
      expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
    });

    it("selects the radio matching the recorded decision, both ways", () => {
      renderDecided();
      let checked = (screen.getAllByRole("radio") as HTMLInputElement[]).find((r) => r.checked);
      expect(checked?.value).toBe("CONFIRMED");

      cleanup();
      renderDecided({
        factId: QUEUED[0].id,
        decision: "NOT CONFIRMED",
        reasonCode: "NOT LOCATED",
      });
      checked = (screen.getAllByRole("radio") as HTMLInputElement[]).find((r) => r.checked);
      expect(checked?.value).toBe("NOT CONFIRMED");
      // A recorded non-confirmation shows its reason rather than asking again.
      expect(screen.queryByLabelText(/Reason — required/)).not.toBeNull();
    });

    // §3.8.3 forbids a DEFAULT for a fact nobody has decided. It does not
    // forbid showing the analyst the decision they themselves recorded — that
    // is the record, not a default, and hiding it is what produced the
    // contradiction.
    it("still pre-selects nothing on a fact that has no decision", () => {
      render(<FactCard runId={RUN_ID} fact={QUEUED[0]} decision={undefined} queued />);
      const radios = screen.getAllByRole("radio") as HTMLInputElement[];
      expect(radios.every((r) => !r.checked)).toBe(true);
      expect(screen.getByText(/Neither option is selected/)).not.toBeNull();
      expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
      expect(screen.queryByText(/^Confirmed$/)).toBeNull();
    });

    // The generalised invariant, over every state a queued card can be in.
    it.each([
      ["undecided", undefined],
      ["confirmed", { factId: QUEUED[0].id, decision: "CONFIRMED", reasonCode: null }],
      [
        "not confirmed",
        { factId: QUEUED[0].id, decision: "NOT CONFIRMED", reasonCode: "NOT LOCATED" },
      ],
    ] as const)("asserts exactly one state when %s", (_label, decision) => {
      const fact = decision
        ? { ...QUEUED[0], verificationState: decision.decision }
        : QUEUED[0];
      const { container } = render(
        <FactCard
          runId={RUN_ID}
          fact={fact}
          decision={decision as StoredFactDecision | undefined}
          queued
        />
      );

      // Scoped to the two blocks that make the claim, not to any text that
      // happens to read the same way on a control.
      const saysDecided = container.querySelector(".decided") !== null;
      const saysUndecided = screen.queryByText(/Neither option is selected/) !== null;

      // Exactly one of the two readings, never both and never neither.
      expect(saysDecided !== saysUndecided).toBe(true);
    });
  });

  it("posts the decision under the plain name the server action reads", () => {
    // The group name is per-card, but the submitted field must stay
    // `decision` — recordFactDecisionAction reads formData.get("decision").
    renderQueue();
    const first = cardFor(QUEUED[0].name);
    fireEvent.click(within(first).getByLabelText(/Cannot verify/));

    const form = first.querySelector("form") as HTMLFormElement;
    const data = new FormData(form);
    expect(data.get("decision")).toBe("NOT CONFIRMED");
    expect(data.get("factId")).toBe(QUEUED[0].id);
    expect(data.get("runId")).toBe(RUN_ID);
  });
});
