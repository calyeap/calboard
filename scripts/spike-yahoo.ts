import { config } from "dotenv";
config({ path: ".env.local" });
import YahooFinance from "yahoo-finance2";

// yahoo-finance2 v4 (installed: see package.json) exports the class itself as
// the default export rather than a ready-made singleton (v2 API assumed by
// the original brief). Instantiating here is the only deviation from the
// brief's script text — still bounded to the `chart` module only.
const yahooFinance = new YahooFinance();

const lines: string[] = [];
function log(line: string) {
  console.log(line);
  lines.push(line);
}

async function testEquityHistoryAndAdjustment() {
  log("\n=== 1. US equity multi-year history + adjusted/raw behaviour (AAPL) ===");
  const result = await yahooFinance.chart("AAPL", {
    period1: "2019-01-01",
    period2: "2020-12-31",
    interval: "1d",
    events: "div,splits",
  });
  log(`rows: ${result.quotes.length}`);
  log(`first: ${JSON.stringify(result.quotes[0])}`);
  log(`last: ${JSON.stringify(result.quotes[result.quotes.length - 1])}`);
  log(`adjclose field present: ${result.quotes[0].adjclose !== undefined}`);
}

async function testSplitDetection() {
  log("\n=== 2. Splits — AAPL 2020-08-31 4:1 (compare with EODHD-confirmed split from M0) ===");
  const result = await yahooFinance.chart("AAPL", {
    period1: "2020-07-01",
    period2: "2020-09-15",
    interval: "1d",
    events: "div,splits",
  });
  log(`events: ${JSON.stringify(result.events)}`);
}

async function testDividends() {
  log("\n=== 3. Dividends — AAPL 2024 ===");
  const result = await yahooFinance.chart("AAPL", {
    period1: "2024-01-01",
    period2: "2025-01-01",
    interval: "1d",
    events: "div",
  });
  log(`dividend events: ${JSON.stringify(result.events?.dividends)}`);
}

async function testEtf() {
  log("\n=== 4. ETF prices (QQQ) ===");
  const result = await yahooFinance.chart("QQQ", {
    period1: "2026-08-01",
    period2: "2026-08-25",
    interval: "1d",
  });
  log(`rows: ${result.quotes.length}, last close: ${result.quotes[result.quotes.length - 1]?.close}`);
}

async function testCrypto() {
  log("\n=== 5. Crypto (BTC-USD, ETH-USD) ===");
  for (const symbol of ["BTC-USD", "ETH-USD"]) {
    const result = await yahooFinance.chart(symbol, {
      period1: "2026-08-01",
      period2: "2026-08-25",
      interval: "1d",
    });
    log(`${symbol}: rows=${result.quotes.length}, last close=${result.quotes[result.quotes.length - 1]?.close}`);
  }
}

async function testMissingSymbol() {
  log("\n=== 6. Missing/invalid symbol behaviour ===");
  try {
    await yahooFinance.chart("ZZZZZZ-NOT-A-REAL-TICKER", { period1: "2026-08-01", period2: "2026-08-25" });
    log("no error thrown — unexpected, note this in the results log");
  } catch (err) {
    log(`threw as expected: ${err instanceof Error ? err.message : err}`);
  }
}

async function testRateLimitBehaviour() {
  log("\n=== 7. Rapid-fire request behaviour (rough stale/failure/rate-limit probe) ===");
  const start = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      yahooFinance.chart("AAPL", { period1: "2026-08-20", period2: "2026-08-25" })
    )
  );
  const failures = results.filter((r) => r.status === "rejected");
  log(`10 requests in ${Date.now() - start}ms, ${failures.length} failed`);
  if (failures.length > 0) {
    log(`sample failure: ${(failures[0] as PromiseRejectedResult).reason}`);
  }
}

async function main() {
  await testEquityHistoryAndAdjustment();
  await testSplitDetection();
  await testDividends();
  await testEtf();
  await testCrypto();
  await testMissingSymbol();
  await testRateLimitBehaviour();
  log("\n\n=== Paste everything above into docs/superpowers/plans/2026-08-25-yahoo-spike-results.md ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
