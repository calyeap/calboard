// ---------------------------------------------------------------------------
// EDGAR access. Milestone M8-a.
//
// Two obligations EDGAR states and this client honours, both because they are
// required and because being blocked mid-run is worse than being refused
// up front:
//
//  1. A User-Agent identifying the requester, with a contact address. Refused
//     at construction if absent, not at the first request.
//  2. A request rate below the published ceiling. Requests are serialised
//     through one queue with a minimum interval, so concurrent callers cannot
//     burst past it.
//
// And one this client adds: it FAILS CLOSED. A 403 or 429 raises and stops.
// There is deliberately no retry, no backoff loop and no fallback endpoint —
// retrying into a rate limiter is how a soft throttle becomes a hard block,
// and a half-acquired fact set is worse than none. A run that cannot acquire
// its facts must not produce a report.
// ---------------------------------------------------------------------------

/** Base error for anything that stopped acquisition reaching EDGAR's answer. */
export class SecAccessError extends Error {
  readonly url: string;
  readonly status: number | null;

  constructor(url: string, status: number | null, detail: string) {
    super(`SEC request failed (${status ?? "no response"}) for ${url}: ${detail}`);
    this.name = "SecAccessError";
    this.url = url;
    this.status = status;
  }
}

/**
 * Rate-limited or blocked. Separated from SecAccessError because the operator
 * response differs: a 500 is worth running again later, a 429 means this
 * client's own behaviour needs to change first.
 */
export class SecRateLimitError extends SecAccessError {
  constructor(url: string, status: number) {
    super(
      url,
      status,
      "EDGAR refused the request as rate-limited or blocked. Not retried — " +
        "retrying into a rate limiter is how a throttle becomes a block. " +
        "Wait, then re-run."
    );
    this.name = "SecRateLimitError";
  }
}

export class SecUserAgentMissingError extends Error {
  constructor(detail: string) {
    super(
      `SEC_USER_AGENT ${detail}. EDGAR requires a User-Agent identifying the ` +
        `requester, in the form "Product/Version (contact@example.com)".`
    );
    this.name = "SecUserAgentMissingError";
  }
}

export interface SecClientOptions {
  /** Required. `Product/Version (contact@example.com)`. */
  userAgent: string;
  /** Injected for tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Minimum milliseconds between the START of one request and the next. EDGAR
   * publishes a ten-per-second ceiling; the default sits well under it,
   * because the cost of being slightly slow is seconds and the cost of being
   * slightly fast is the whole run.
   */
  minIntervalMs?: number;
  /** Per-request timeout. A hung socket must not hang the run. */
  timeoutMs?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 150;
const DEFAULT_TIMEOUT_MS = 30_000;

// Deliberately loose: it tests that SOMETHING contactable is present, not that
// the address is valid. A stricter pattern would reject legitimate contacts
// and teach the operator to work around this check rather than satisfy it.
const CONTACT_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export class SecClient {
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;

  // The rate limiter. Every request awaits the tail of this chain before it
  // starts, so N concurrent callers queue rather than burst.
  private gate: Promise<void> = Promise.resolve();
  private lastStartedAt = 0;

  constructor(options: SecClientOptions) {
    const ua = options.userAgent?.trim() ?? "";
    if (ua === "") throw new SecUserAgentMissingError("is not set");
    if (!CONTACT_RE.test(ua)) {
      throw new SecUserAgentMissingError("carries no contact address");
    }

    this.userAgent = ua;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * One GET, rate-limited, failing closed.
   *
   * Returns parsed JSON. A non-OK status raises; there is no "returned null so
   * the caller can carry on" path, because carrying on is what produces a
   * report built on a fact set that was never acquired.
   */
  async getJson<T = unknown>(url: string): Promise<T> {
    await this.waitForSlot();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          "User-Agent": this.userAgent,
          // EDGAR serves gzip; asking for it is part of being a well-behaved
          // client under the same policy that requires the User-Agent.
          "Accept-Encoding": "gzip, deflate",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (err) {
      throw new SecAccessError(url, null, err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429 || response.status === 403) {
      throw new SecRateLimitError(url, response.status);
    }
    if (!response.ok) {
      throw new SecAccessError(url, response.status, response.statusText || "non-OK status");
    }

    try {
      return (await response.json()) as T;
    } catch (err) {
      throw new SecAccessError(
        url,
        response.status,
        `response was not JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /** The ticker-to-CIK directory. */
  async companyTickers(): Promise<CompanyTickerDirectory> {
    return this.getJson<CompanyTickerDirectory>("https://www.sec.gov/files/company_tickers.json");
  }

  /** Every XBRL fact the company has tagged, across every filing. */
  async companyFacts(cik: string): Promise<CompanyFactsDocument> {
    return this.getJson<CompanyFactsDocument>(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`
    );
  }

  /** Filing history — used to cite the document a tagged figure came from. */
  async submissions(cik: string): Promise<SubmissionsDocument> {
    return this.getJson<SubmissionsDocument>(
      `https://data.sec.gov/submissions/CIK${cik}.json`
    );
  }

  private waitForSlot(): Promise<void> {
    const wait = this.gate.then(async () => {
      const since = Date.now() - this.lastStartedAt;
      const owed = this.minIntervalMs - since;
      if (owed > 0) await new Promise((r) => setTimeout(r, owed));
      this.lastStartedAt = Date.now();
    });
    // The chain must not break on a rejected caller, or one failure would free
    // every subsequent request to run unthrottled.
    this.gate = wait.catch(() => undefined);
    return wait;
  }
}

// ---------------------------------------------------------------------------
// The shapes this milestone reads. Deliberately partial — these describe what
// acquisition uses, not everything EDGAR returns.
// ---------------------------------------------------------------------------

export interface CompanyTickerRow {
  cik_str: number;
  ticker: string;
  title: string;
}

export type CompanyTickerDirectory = Record<string, CompanyTickerRow>;

export interface XbrlFactUnitRow {
  /** Period start, for duration facts. Absent on instant facts. */
  start?: string;
  /** Period end, or the instant. */
  end: string;
  val: number;
  /** Fiscal year the filing reporting this fact belongs to. */
  fy?: number;
  /** FY, Q1, Q2, Q3. */
  fp?: string;
  form?: string;
  /** Filing date — the closest thing EDGAR gives to "when this was published". */
  filed?: string;
  accn?: string;
  frame?: string;
}

export interface XbrlTagFacts {
  label?: string | null;
  description?: string | null;
  units: Record<string, XbrlFactUnitRow[]>;
}

export interface CompanyFactsDocument {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, XbrlTagFacts>>;
}

export interface SubmissionsDocument {
  cik: string;
  name: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      filingDate?: string[];
      primaryDocument?: string[];
      reportDate?: string[];
    };
  };
}

/**
 * Resolves a ticker to its zero-padded ten-digit CIK, which is the form the
 * companyfacts and submissions paths want.
 */
export function cikForTicker(
  directory: CompanyTickerDirectory,
  ticker: string
): { cik: string; title: string } | null {
  const wanted = ticker.trim().toUpperCase();
  for (const key of Object.keys(directory)) {
    const row = directory[key];
    if (row?.ticker?.toUpperCase() === wanted) {
      return { cik: String(row.cik_str).padStart(10, "0"), title: row.title };
    }
  }
  return null;
}

/**
 * Builds a client from the environment.
 *
 * Throws when SEC_USER_AGENT is unset rather than substituting a default. A
 * default User-Agent would be a shared identity across every Calboard install,
 * which is the thing EDGAR's policy exists to prevent.
 */
export function secClientFromEnv(overrides: Partial<SecClientOptions> = {}): SecClient {
  return new SecClient({ userAgent: process.env.SEC_USER_AGENT ?? "", ...overrides });
}
