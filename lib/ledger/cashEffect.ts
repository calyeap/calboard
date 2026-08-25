import Decimal from "decimal.js";

export type SupportedTxnType = "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL" | "ADJUSTMENT";

export interface CashEffectInput {
  txnType: SupportedTxnType;
  quantity?: Decimal | null;
  priceUsd?: Decimal | null;
  feesUsd: Decimal;
  grossAmountUsd?: Decimal | null;
}

export function computeCashEffectUsd(input: CashEffectInput): Decimal {
  const { txnType, quantity, priceUsd, feesUsd, grossAmountUsd } = input;

  switch (txnType) {
    case "BUY": {
      if (!quantity || !priceUsd) {
        throw new Error("BUY requires quantity and priceUsd");
      }
      return quantity.mul(priceUsd).neg().sub(feesUsd);
    }
    case "SELL": {
      if (!quantity || !priceUsd) {
        throw new Error("SELL requires quantity and priceUsd");
      }
      return quantity.mul(priceUsd).sub(feesUsd);
    }
    case "DEPOSIT": {
      if (!grossAmountUsd) {
        throw new Error("DEPOSIT requires grossAmountUsd");
      }
      return grossAmountUsd;
    }
    case "WITHDRAWAL": {
      if (!grossAmountUsd) {
        throw new Error("WITHDRAWAL requires grossAmountUsd");
      }
      return grossAmountUsd.neg();
    }
    case "ADJUSTMENT": {
      // Unlike DEPOSIT/WITHDRAWAL, grossAmountUsd here is already the signed
      // cash effect (not an unsigned amount the type implies a sign for) —
      // an opening-cash adjustment passes it explicitly; an opening-position
      // adjustment omits it, defaulting to zero (opening a position must not
      // consume cash).
      return grossAmountUsd ?? new Decimal(0);
    }
  }
}
