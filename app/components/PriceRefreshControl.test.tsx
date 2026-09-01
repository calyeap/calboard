// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { refreshAllPricesAction } from "@/app/actions/prices";
import { PriceRefreshControl } from "./PriceRefreshControl";

vi.mock("@/app/actions/prices", () => ({ refreshAllPricesAction: vi.fn() }));
const refreshMock = vi.mocked(refreshAllPricesAction);
const refreshRouter = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshRouter }) }));

afterEach(cleanup);
beforeEach(() => {
  refreshMock.mockReset();
  refreshRouter.mockReset();
});

describe("PriceRefreshControl", () => {
  it("shows the checked-at text and a refresh control", () => {
    render(<PriceRefreshControl checkedAt="29 Aug, 21:04 SGT" />);
    expect(screen.getByText(/data checked 29 aug, 21:04 sgt/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh prices/i })).toBeInTheDocument();
  });

  it("on click, disables the button, then shows an 'unchanged' success state and refreshes the router", async () => {
    refreshMock.mockResolvedValue({ ok: true, changed: false });
    render(<PriceRefreshControl checkedAt="29 Aug, 21:04 SGT" />);

    fireEvent.click(screen.getByRole("button", { name: /refresh prices/i }));
    expect(screen.getByRole("button", { name: /refresh prices/i })).toBeDisabled();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/up to date/i));
    expect(refreshRouter).toHaveBeenCalledTimes(1);
  });

  it("on click, when data changed, shows an 'updated' success state", async () => {
    refreshMock.mockResolvedValue({ ok: true, changed: true });
    render(<PriceRefreshControl checkedAt="29 Aug, 21:04 SGT" />);

    fireEvent.click(screen.getByRole("button", { name: /refresh prices/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/updated/i));
  });

  it("on failure, shows an alert and does not refresh the router", async () => {
    refreshMock.mockResolvedValue({ ok: false, changed: false, message: "Price refresh failed for every holding." });
    render(<PriceRefreshControl checkedAt="29 Aug, 21:04 SGT" />);

    fireEvent.click(screen.getByRole("button", { name: /refresh prices/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/price refresh failed/i));
    expect(refreshRouter).not.toHaveBeenCalled();
  });

  it("a partial failure still shows the (muted) success state text alongside the warning", async () => {
    refreshMock.mockResolvedValue({ ok: true, changed: true, message: "1 of 2 holdings couldn't be refreshed." });
    render(<PriceRefreshControl checkedAt="29 Aug, 21:04 SGT" />);

    fireEvent.click(screen.getByRole("button", { name: /refresh prices/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/updated/i));
    expect(screen.getByText(/1 of 2 holdings couldn't be refreshed/i)).toBeInTheDocument();
  });
});
