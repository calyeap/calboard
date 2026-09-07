// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { MSFT_FIXTURE } from "@/lib/analyzer/fixtures/msft";
import { queuedFacts } from "@/lib/analyzer/spotCheck";

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
