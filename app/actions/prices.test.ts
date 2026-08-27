import { describe, it, expect, vi, beforeEach } from "vitest";
import { revalidatePath } from "next/cache";
import { upsertLatestPrice } from "@/lib/marketdata";
import { retryPriceFetchAction } from "./prices";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/marketdata", () => ({ upsertLatestPrice: vi.fn() }));

const revalidatePathMock = vi.mocked(revalidatePath);
const upsertLatestPriceMock = vi.mocked(upsertLatestPrice);

beforeEach(() => {
  revalidatePathMock.mockReset();
  upsertLatestPriceMock.mockReset();
});

describe("retryPriceFetchAction", () => {
  it("on success fetches the price and revalidates both / and /holdings", async () => {
    upsertLatestPriceMock.mockResolvedValue({ fromCache: false, provider: "YAHOO" });

    const result = await retryPriceFetchAction("1", "AAPL", "equity");

    expect(result).toEqual({ ok: true });
    expect(upsertLatestPriceMock).toHaveBeenCalledWith("1", "AAPL", "equity");
    const revalidated = revalidatePathMock.mock.calls.map((c) => c[0]);
    expect(revalidated).toContain("/");
    expect(revalidated).toContain("/holdings");
  });

  it("on failure reports the error and revalidates nothing", async () => {
    upsertLatestPriceMock.mockRejectedValue(new Error("provider down"));

    const result = await retryPriceFetchAction("1", "AAPL", "equity");

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/provider down/i);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
