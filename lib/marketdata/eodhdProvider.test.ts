import { describe, it, expect } from "vitest";
import { toEodhdSymbol } from "./eodhdProvider";

describe("toEodhdSymbol", () => {
  it("maps equity tickers to the .US suffix", () => {
    expect(toEodhdSymbol("aapl", "equity")).toBe("AAPL.US");
  });
  it("maps ETF tickers to the .US suffix", () => {
    expect(toEodhdSymbol("qqq", "etf")).toBe("QQQ.US");
  });
  it("maps crypto tickers to the .CC suffix", () => {
    expect(toEodhdSymbol("btc-usd", "crypto")).toBe("BTC-USD.CC");
  });
});
