// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { JUDGMENTS } from "@/lib/analyzer/judgments";
import { JUDGMENT_KEYS } from "@/lib/analyzer/decisions";

vi.mock("@/app/actions/analyzer", () => ({
  recordJudgmentAction: vi.fn(),
}));

const { JudgmentSelector } = await import("./JudgmentSelector");

afterEach(cleanup);

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function judgment(key: string) {
  const found = JUDGMENTS.find((j) => j.key === key);
  if (!found) throw new Error(`No judgment ${key}`);
  return found;
}

function renderJudgment(key: string, existing?: Parameters<typeof JudgmentSelector>[0]["existing"]) {
  return render(
    <JudgmentSelector runId={RUN_ID} judgment={judgment(key)} existing={existing} />
  );
}

describe("the §4.4 judgment definitions", () => {
  it("covers all three of §4.4's judgments, in the order the mock presents them", () => {
    expect(JUDGMENTS.map((j) => j.key)).toEqual([
      "ACCOUNTING-BASIS WINDOW",
      "NON-OPERATING INVESTMENTS",
      "MEDIAN-MARGIN NOPAT WINDOW",
    ]);
    // The stored vocabulary and the presented set must not drift apart.
    expect([...JUDGMENT_KEYS].sort()).toEqual(JUDGMENTS.map((j) => j.key).sort());
  });

  // The two the mock enumerates carry options; the third carries a stated gap
  // and no invented list. If a future session adds options to the third, this
  // fails and the mock should be checked before the test is changed.
  it("has options exactly where the mock supplies them", () => {
    expect(judgment("ACCOUNTING-BASIS WINDOW").options).toHaveLength(2);
    expect(judgment("MEDIAN-MARGIN NOPAT WINDOW").options).toHaveLength(2);
    expect(judgment("NON-OPERATING INVESTMENTS").options).toBeNull();
    expect(judgment("NON-OPERATING INVESTMENTS").gap).toBeTruthy();
  });
});

describe("a judgment the mock enumerates", () => {
  it("presents each option with the figure it produces", () => {
    renderJudgment("ACCOUNTING-BASIS WINDOW");

    const restated = screen.getByText("Restated FY2016 — full ten-year window").closest(".option");
    expect(within(restated as HTMLElement).getByText("13.8%")).not.toBeNull();
    expect(within(restated as HTMLElement).getByText("revenue CAGR")).not.toBeNull();

    const shortened = screen
      .getByText("Shortened window — FY2017–FY2026, no restatement needed")
      .closest(".option");
    expect(within(shortened as HTMLElement).getByText("14.7%")).not.toBeNull();
  });

  it("shows the excluded option, and offers no control for it", () => {
    const { container } = renderJudgment("ACCOUNTING-BASIS WINDOW");

    const excluded = container.querySelector(".option.excluded") as HTMLElement;
    expect(excluded).not.toBeNull();
    expect(within(excluded).getByText("Mixed basis — the figure originally used")).not.toBeNull();
    expect(within(excluded).getByText("14.6%")).not.toBeNull();
    expect(
      within(excluded).getByText("Not offered — inconsistent accounting basis across the window")
    ).not.toBeNull();
    // Shown, not selectable.
    expect(excluded.querySelector("input")).toBeNull();
    // ...and it is not one of the radios.
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("pre-selects nothing and gates the submit until a choice is made", () => {
    renderJudgment("ACCOUNTING-BASIS WINDOW");
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.every((r) => !r.checked)).toBe(true);
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);

    fireEvent.click(radios[0]);
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
  });

  it("posts the chosen option's label as the selection", () => {
    const { container } = renderJudgment("MEDIAN-MARGIN NOPAT WINDOW");
    fireEvent.click(screen.getByLabelText(/Nine-year median margin/));

    const data = new FormData(container.querySelector("form") as HTMLFormElement);
    expect(data.get("selection")).toBe("Nine-year median margin, restatement-free window");
    expect(data.get("judgmentKey")).toBe("MEDIAN-MARGIN NOPAT WINDOW");
    expect(data.get("runId")).toBe(RUN_ID);
  });

  it("shows a recorded judgment as chosen rather than as a blank", () => {
    renderJudgment("MEDIAN-MARGIN NOPAT WINDOW", {
      judgmentKey: "MEDIAN-MARGIN NOPAT WINDOW",
      selection: "Ten-year median margin",
      reason: "no restatement in the window",
    });
    const checked = (screen.getAllByRole("radio") as HTMLInputElement[]).find((r) => r.checked);
    expect(checked?.value).toBe("Ten-year median margin");
    expect(screen.getByRole("button").textContent).toMatch(/Update judgment/);
  });

  // Two selectors on one screen must not share a radio group, for the reason
  // the fact cards carry per-card names.
  it("gives each judgment its own radio group", () => {
    render(
      <>
        <JudgmentSelector
          runId={RUN_ID}
          judgment={judgment("ACCOUNTING-BASIS WINDOW")}
          existing={undefined}
        />
        <JudgmentSelector
          runId={RUN_ID}
          judgment={judgment("MEDIAN-MARGIN NOPAT WINDOW")}
          existing={undefined}
        />
      </>
    );
    const names = new Set((screen.getAllByRole("radio") as HTMLInputElement[]).map((r) => r.name));
    expect(names.size).toBe(2);
  });
});

describe("the judgment whose options are not enumerable", () => {
  it("states the gap rather than offering an empty or invented list", () => {
    const { container } = renderJudgment("NON-OPERATING INVESTMENTS");

    expect(container.querySelector(".option")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText(/not enumerable yet/)).not.toBeNull();
    expect(screen.getByText(/arrives with fact acquisition/)).not.toBeNull();
  });

  it("keeps a typed control, and does not gate its submit on a selection", () => {
    renderJudgment("NON-OPERATING INVESTMENTS");
    expect(screen.getByLabelText(/Classification/)).not.toBeNull();
    // Nothing to select, so nothing to wait for.
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
  });
});
