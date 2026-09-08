import { describe, it, expect, vi } from "vitest";
import {
  SecClient,
  SecAccessError,
  SecRateLimitError,
  SecUserAgentMissingError,
  cikForTicker,
} from "./secClient";

// ---------------------------------------------------------------------------
// The client is tested against an injected fetch, never the live network. A
// test that hits EDGAR would be a test of the SEC's availability, and would
// consume the rate budget the real run needs.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SecClient — the User-Agent EDGAR requires", () => {
  it("refuses to construct without a User-Agent", () => {
    expect(() => new SecClient({ userAgent: "" })).toThrow(SecUserAgentMissingError);
    expect(() => new SecClient({ userAgent: "   " })).toThrow(SecUserAgentMissingError);
  });

  it("refuses a User-Agent carrying no contact address", () => {
    // EDGAR's published policy is that the User-Agent identifies the
    // requester. A bare product name identifies nobody, and being refused
    // access mid-run is worse than being refused at construction.
    expect(() => new SecClient({ userAgent: "Calboard/1.0" })).toThrow(SecUserAgentMissingError);
  });

  it("sends the User-Agent on every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new SecClient({
      userAgent: "Calboard/1.0 (someone@example.com)",
      fetchImpl: fetchMock,
      minIntervalMs: 0,
    });

    await client.getJson("https://data.sec.gov/thing.json");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("user-agent")).toBe(
      "Calboard/1.0 (someone@example.com)"
    );
  });
});

describe("SecClient — failing closed rather than retrying into a block", () => {
  it("throws SecRateLimitError on 429 and does not retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "slow down" }, 429));
    const client = new SecClient({
      userAgent: "Calboard/1.0 (someone@example.com)",
      fetchImpl: fetchMock,
      minIntervalMs: 0,
    });

    await expect(client.getJson("https://data.sec.gov/thing.json")).rejects.toBeInstanceOf(
      SecRateLimitError
    );
    // The whole point: one attempt. A retry loop against a rate limiter is how
    // a soft throttle becomes a hard block.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws SecRateLimitError on 403 and does not retry", async () => {
    // EDGAR answers an unacceptable User-Agent, and a client it has decided to
    // block, with 403 rather than 429.
    const fetchMock = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const client = new SecClient({
      userAgent: "Calboard/1.0 (someone@example.com)",
      fetchImpl: fetchMock,
      minIntervalMs: 0,
    });

    await expect(client.getJson("https://data.sec.gov/thing.json")).rejects.toBeInstanceOf(
      SecRateLimitError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws SecAccessError on any other non-OK status, without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new SecClient({
      userAgent: "Calboard/1.0 (someone@example.com)",
      fetchImpl: fetchMock,
      minIntervalMs: 0,
    });

    await expect(client.getJson("https://data.sec.gov/thing.json")).rejects.toBeInstanceOf(
      SecAccessError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a 404 as an access error rather than an empty fact set", async () => {
    // A company with no companyfacts document must not look like a company
    // with no facts — the first is an acquisition failure, the second would
    // silently produce a report with every output INCOMPLETE for the wrong
    // reason.
    const fetchMock = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));
    const client = new SecClient({
      userAgent: "Calboard/1.0 (someone@example.com)",
      fetchImpl: fetchMock,
      minIntervalMs: 0,
    });

    await expect(client.getJson("https://data.sec.gov/missing.json")).rejects.toBeInstanceOf(
      SecAccessError
    );
  });
});

describe("SecClient — rate limiting", () => {
  it("spaces requests by at least the configured interval", async () => {
    const at: number[] = [];
    const fetchMock = vi.fn().mockImplementation(async () => {
      at.push(Date.now());
      return jsonResponse({ ok: true });
    });
    const client = new SecClient({
      userAgent: "Calboard/1.0 (someone@example.com)",
      fetchImpl: fetchMock,
      minIntervalMs: 60,
    });

    await client.getJson("https://data.sec.gov/a.json");
    await client.getJson("https://data.sec.gov/b.json");
    await client.getJson("https://data.sec.gov/c.json");

    expect(at).toHaveLength(3);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(55);
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(55);
  });

  it("serialises concurrent callers rather than letting them burst", async () => {
    const at: number[] = [];
    const fetchMock = vi.fn().mockImplementation(async () => {
      at.push(Date.now());
      return jsonResponse({ ok: true });
    });
    const client = new SecClient({
      userAgent: "Calboard/1.0 (someone@example.com)",
      fetchImpl: fetchMock,
      minIntervalMs: 40,
    });

    await Promise.all([
      client.getJson("https://data.sec.gov/a.json"),
      client.getJson("https://data.sec.gov/b.json"),
      client.getJson("https://data.sec.gov/c.json"),
    ]);

    expect(at[1] - at[0]).toBeGreaterThanOrEqual(35);
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(35);
  });
});

describe("cikForTicker", () => {
  const directory = {
    "0": { cik_str: 789019, ticker: "MSFT", title: "MICROSOFT CORP" },
    "1": { cik_str: 1849056, ticker: "OKLO", title: "Oklo Inc." },
  };

  it("zero-pads the CIK to ten digits, which is what the API path wants", () => {
    expect(cikForTicker(directory, "MSFT")).toEqual({
      cik: "0000789019",
      title: "MICROSOFT CORP",
    });
  });

  it("is case-insensitive on the ticker", () => {
    expect(cikForTicker(directory, "msft")?.cik).toBe("0000789019");
  });

  it("returns null for a ticker the directory does not carry", () => {
    expect(cikForTicker(directory, "NOTATICKER")).toBeNull();
  });
});
