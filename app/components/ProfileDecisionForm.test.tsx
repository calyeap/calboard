// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/actions/analyzer", () => ({
  recordProfileDecisionAction: vi.fn(),
}));

const { ProfileDecisionForm } = await import("./ProfileDecisionForm");

afterEach(cleanup);

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const RECOMMENDED = "Mature, profitable, stable FCF";

function renderStep6() {
  return render(<ProfileDecisionForm runId={RUN_ID} recommendedLabel={RECOMMENDED} />);
}

describe("Step 6 profile decision", () => {
  // The deliberate contrast with Step 2. Here ONE group is correct: these are
  // three answers to a single question, so choosing one must clear the others.
  // In Step 2 each card is its own question, and sharing a group name across
  // them is the defect. Same mechanism, opposite requirement — asserted rather
  // than assumed, because "radios share a name" is right in one place and
  // wrong in the other.
  it("puts its three outcomes in exactly one radio group", () => {
    renderStep6();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
  });

  it("offers exactly the three §6.3 outcomes, none pre-selected", () => {
    renderStep6();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(["CONFIRMED", "OVERRIDDEN", "CANNOT JUDGE"]);
    expect(radios.every((r) => !r.checked)).toBe(true);
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("moves the selection between outcomes rather than accumulating them", () => {
    renderStep6();
    fireEvent.click(screen.getByLabelText(/Confirm recommended profile/));
    fireEvent.click(screen.getByLabelText(/Cannot judge/));

    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const checked = radios.filter((r) => r.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].value).toBe("CANNOT JUDGE");
  });

  it("reveals the override profile and reason only on Override, and requires the reason", () => {
    renderStep6();
    expect(screen.queryByLabelText(/Reason — required/)).toBeNull();

    fireEvent.click(screen.getByLabelText(/^Override/));

    const reason = screen.getByLabelText(/Reason — required/) as HTMLInputElement;
    expect(reason.required).toBe(true);
    expect(screen.getByLabelText(/^Profile/)).not.toBeNull();
  });

  // §6.3: Cannot judge records no reason.
  it("asks for no reason on Cannot judge, and explains what it does", () => {
    renderStep6();
    fireEvent.click(screen.getByLabelText(/Cannot judge/));

    expect(screen.queryByLabelText(/Reason — required/)).toBeNull();
    expect(screen.getByText(/not human-confirmed/)).not.toBeNull();
    expect(screen.getByText(/PARTIAL/)).not.toBeNull();
  });

  it("posts the recommended profile alongside the decision", () => {
    const { container } = renderStep6();
    fireEvent.click(screen.getByLabelText(/Confirm recommended profile/));

    const form = container.querySelector("form") as HTMLFormElement;
    const data = new FormData(form);
    expect(data.get("decision")).toBe("CONFIRMED");
    expect(data.get("recommendedProfile")).toBe(RECOMMENDED);
    expect(data.get("runId")).toBe(RUN_ID);
  });
});
