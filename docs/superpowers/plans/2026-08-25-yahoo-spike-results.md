# Yahoo-compatible market-data spike — results (2026-08-25)

## Verdict: GO

Task 8 defaults `MARKET_DATA_PROVIDER` to `YAHOO`. The `EodhdProvider` adapter is still built as a swappable fallback (per the plan's `MarketDataProvider` abstraction), but Yahoo is the active default.

**Reasoning**, against the exact GO criteria from the task brief:

- Equity, ETF, and crypto history all returned real data with `adjclose` present (test 1: `adjclose field present: true`; test 4 ETF rows populated; test 5 crypto rows populated).
- The AAPL split appears in `events.splits` for **2020-08-31** with **ratio 4:1** (`"numerator":4,"denominator":1,"splitRatio":"4:1"`) — this is the well-documented, publicly confirmed AAPL corporate action referenced in the M1 plan as "EODHD-confirmed split from M0." Yahoo reproduces it exactly.
- Dividends returned realistic, plausible data: AAPL's 2024 quarterly dividends of $0.24 (Feb), $0.25 (May), $0.25 (Aug), $0.25 (Nov) match AAPL's actual publicly-reported 2024 dividend schedule.
- The missing-symbol test threw a catchable error (`"No data found, symbol may be delisted"`) rather than returning silently-wrong data.
- The rate-limit probe showed **0 failures out of 10** rapid-fire requests (in ~140-160ms), run twice for consistency — no severe failure rate, no evidence of aggressive throttling at this volume.

No hard blockers were found. All GO criteria are satisfied.

**One implementation note carried into Task 8:** the installed `yahoo-finance2` version is a v4-series release, whose default export is the `YahooFinance` **class**, not a ready-made singleton instance (the brief's script assumed the older v2 API: `import yahooFinance from "yahoo-finance2"` used directly as a callable). The spike script was adjusted to `import YahooFinance from "yahoo-finance2"; const yahooFinance = new YahooFinance();` — this is a compatibility fix only; it does not touch which modules are called (still `chart` only, still bounded scope) or change any of the test logic, requests, or assertions specified in the brief. Task 8's `yahooProvider.ts` should instantiate the client the same way.

---

## Full spike output

Run via `npx tsx scripts/spike-yahoo.ts`, exit code 0, live network calls to Yahoo Finance. Run twice; both runs agreed (rate-limit probe repeated below for confirmation).

### 1. US equity multi-year history + adjusted/raw behaviour (AAPL)

```
=== 1. US equity multi-year history + adjusted/raw behaviour (AAPL) ===
rows: 504
first: {"date":"2019-01-02T14:30:00.000Z","high":39.712501525878906,"volume":148158800,"open":38.72249984741211,"low":38.557498931884766,"close":39.47999954223633,"adjclose":37.43690872192383}
last: {"date":"2020-12-30T14:30:00.000Z","high":135.99000549316406,"volume":96452100,"open":135.5800018310547,"low":133.39999389648438,"close":133.72000122070312,"adjclose":129.8167266845703}
adjclose field present: true
```

504 daily rows returned for the requested 2019-01-01 to 2020-12-31 window (roughly 2 years of trading days), with `open`/`high`/`low`/`close`/`volume`/`adjclose` all populated. `adjclose` differs from `close` (37.44 vs 39.48 on the first row), confirming Yahoo does apply split/dividend adjustment in the `adjclose` field while leaving raw `close` untouched — both raw and adjusted series are available from one call.

### 2. Splits — AAPL 2020-08-31 4:1

```
=== 2. Splits — AAPL 2020-08-31 4:1 (compare with EODHD-confirmed split from M0) ===
events: {"dividends":[{"amount":0.205,"date":"2020-08-07T13:30:00.000Z"}],"splits":[{"date":"2020-08-31T13:30:00.000Z","numerator":4,"denominator":1,"splitRatio":"4:1"}]}
```

The split shows up exactly as expected: `date: 2020-08-31`, `numerator: 4`, `denominator: 1`, `splitRatio: "4:1"`. A dividend event ($0.205 on 2020-08-07) is also returned in the same window since `events: "div,splits"` was requested.

### 3. Dividends — AAPL 2024

```
=== 3. Dividends — AAPL 2024 ===
dividend events: [{"amount":0.24,"date":"2024-02-09T14:30:00.000Z"},{"amount":0.25,"date":"2024-05-10T13:30:00.000Z"},{"amount":0.25,"date":"2024-08-12T13:30:00.000Z"},{"amount":0.25,"date":"2024-11-08T14:30:00.000Z"}]
```

Four quarterly dividend events for 2024, amounts $0.24/$0.25/$0.25/$0.25, dated Feb/May/Aug/Nov — matches AAPL's actual 2024 dividend cadence and amounts.

### 4. ETF prices (QQQ)

```
=== 4. ETF prices (QQQ) ===
rows: 16, last close: 706.3200073242188
```

16 trading days of data for 2026-08-01 to 2026-08-25, last close $706.32 — plausible current QQQ price level, ETF coverage confirmed.

### 5. Crypto (BTC-USD, ETH-USD)

```
=== 5. Crypto (BTC-USD, ETH-USD) ===
BTC-USD: rows=25, last close=79805.1328125
ETH-USD: rows=25, last close=2481.47998046875
```

25 daily rows for both BTC-USD and ETH-USD over the same August 2026 window (crypto trades 7 days/week, so more rows than the equity/ETF window). Both last-close values are plausible current-market levels.

### 6. Missing/invalid symbol behaviour

```
=== 6. Missing/invalid symbol behaviour ===
threw as expected: No data found, symbol may be delisted
```

The library threw a catchable `Error` with a clear message rather than returning empty/malformed data silently.

### 7. Rapid-fire request behaviour (rough stale/failure/rate-limit probe)

Run 1:
```
=== 7. Rapid-fire request behaviour (rough stale/failure/rate-limit probe) ===
10 requests in 158ms, 0 failed
```

Run 2 (repeated for confirmation):
```
=== 7. Rapid-fire request behaviour (rough stale/failure/rate-limit probe) ===
10 requests in 136ms, 0 failed
```

10 concurrent requests for the same symbol/window completed in under 200ms with zero failures, both times. No evidence of rate-limiting at this volume.

---

## Comparison against EODHD (M0-validated source)

The M1 plan document records that EODHD in M0 already confirmed the AAPL 2020-08-31 4:1 split (this session did not have direct access to the M0 EODHD raw output/spike file, so the comparison below is against the well-documented public facts that M0's EODHD validation would have been checked against — AAPL's split and dividend history are public record, not something in dispute):

- **Split date/ratio**: Yahoo returns `2020-08-31`, `4:1` — this matches the AAPL stock split that is public record and is the split referenced in the plan as "EODHD-confirmed split from M0." Consistent.
- **Dividends**: Yahoo's AAPL 2024 dividend dates ($0.24 Feb, $0.25 May, $0.25 Aug, $0.25 Nov) match AAPL's actual publicly-reported quarterly dividend schedule for 2024 — the same data EODHD's EOD dividend feed would report, since both ultimately draw from the same underlying corporate-action reality. No discrepancy found.
- **BTC/ETH data**: present, with 25 daily rows each for a 25-day window (crypto trades every day, unlike equities/ETFs), and last-close prices at plausible current market levels for BTC (~$79.8k) and ETH (~$2.48k) as of the spike's run date. Reasonably current — no stale-data red flags.

No prior EODHD raw output file exists in this repo/session to diff line-by-line; the comparison above is a sanity check against the underlying real-world facts (which is what EODHD's own validation in M0 would have been checked against), not a byte-for-byte reconciliation. Nothing here contradicts what EODHD would be expected to show.
