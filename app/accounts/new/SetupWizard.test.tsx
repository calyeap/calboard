// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { localTodayIso } from "@/lib/dateValidation";
import { SetupWizard } from "./SetupWizard";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
});

// Vitest isn't run with globals:true, so @testing-library/react's automatic
// afterEach(cleanup) isn't registered — unmount between tests explicitly.
afterEach(() => {
  cleanup();
});

describe("SetupWizard — Step 1 (as-of date)", () => {
  it("mounts on Step 1 showing today's as-of date as a plain line, with no date input visible", () => {
    render(<SetupWizard />);

    expect(screen.getByRole("heading", { name: /add your holdings/i })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`current as of ${localTodayIso()}`, "i"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change date/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("As-of date")).toBeNull();
  });

  it("'Change date' reveals the date input", () => {
    render(<SetupWizard />);
    fireEvent.click(screen.getByRole("button", { name: /change date/i }));
    expect(screen.getByLabelText("As-of date")).toBeInTheDocument();
  });

  it("a future as-of date shows an inline error and keeps the user on Step 1", () => {
    render(<SetupWizard />);
    fireEvent.click(screen.getByRole("button", { name: /change date/i }));
    fireEvent.change(screen.getByLabelText("As-of date"), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /next: review/i }));

    expect(screen.getByText(/future/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /add your holdings/i })).toBeInTheDocument();
  });

  it("Cancel with an unchanged (today) date navigates to /holdings without a confirm prompt", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SetupWizard />);

    fireEvent.click(screen.getByRole("button", { name: /cancel setup/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/holdings");
    confirmSpy.mockRestore();
  });

  it("Cancel after changing the date prompts window.confirm before navigating", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SetupWizard />);

    fireEvent.click(screen.getByRole("button", { name: /change date/i }));
    fireEvent.change(screen.getByLabelText("As-of date"), { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel setup/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/holdings");
    confirmSpy.mockRestore();
  });
});
