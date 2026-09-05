import Decimal from "decimal.js";
import { combineProvenance } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import type { EnterpriseValueBridge, SourcedValue } from "../types";

// M1 — enterprise value and equity bridge (§2.1, §3.5, §7.2). Single
// definition, applied identically to every company (§9 mistake 18): no
// per-company variation, no alternate path.

export interface EnterpriseValueInput {
  sharesOutstanding: SourcedValue<Decimal> | null;
  treasuryMethodDilution: SourcedValue<Decimal> | null;
  price: SourcedValue<Decimal> | null;
  totalDebt: SourcedValue<Decimal> | null;
  financeLeaseLiabilities: SourcedValue<Decimal> | null;
  cashAndMarketableDebtSecurities: SourcedValue<Decimal> | null;
  nonOperatingEquityInvestmentsAtBook: SourcedValue<Decimal> | null;
  // Descriptive only, not a computed figure — carried alongside the book
  // value per §3.5. Independent of whether the other REQUIRED inputs are
  // present.
  nonOperatingInvestmentsErrorDirection: "understates" | "overstates" | null;
}

const REQUIRED_FIELD_NAMES = [
  "sharesOutstanding",
  "treasuryMethodDilution",
  "price",
  "totalDebt",
  "financeLeaseLiabilities",
  "cashAndMarketableDebtSecurities",
  "nonOperatingEquityInvestmentsAtBook",
] as const satisfies readonly (keyof EnterpriseValueInput)[];

// Suppressed by: nothing. INCOMPLETE if any REQUIRED input missing (§7.2
// M1) — never a computed value on partial data.
export function computeEnterpriseValue(input: EnterpriseValueInput): EnterpriseValueBridge {
  const missing = REQUIRED_FIELD_NAMES.filter((name) => input[name] === null);
  if (missing.length > 0) {
    return suppressedValue("INCOMPLETE", `missing REQUIRED input(s): ${missing.join(", ")}`);
  }

  const sharesOutstanding = input.sharesOutstanding as SourcedValue<Decimal>;
  const treasuryMethodDilution = input.treasuryMethodDilution as SourcedValue<Decimal>;
  const price = input.price as SourcedValue<Decimal>;
  const totalDebt = input.totalDebt as SourcedValue<Decimal>;
  const financeLeaseLiabilities = input.financeLeaseLiabilities as SourcedValue<Decimal>;
  const cashAndMarketableDebtSecurities = input.cashAndMarketableDebtSecurities as SourcedValue<Decimal>;
  const nonOperatingEquityInvestmentsAtBook = input.nonOperatingEquityInvestmentsAtBook as SourcedValue<Decimal>;

  // Most recent shares outstanding plus treasury-method dilution — never
  // the weighted-average diluted share count (§3.5).
  const dilutedShares = sharesOutstanding.value.plus(treasuryMethodDilution.value);
  const marketCap = dilutedShares.mul(price.value);

  const enterpriseValue = marketCap
    .plus(totalDebt.value)
    .plus(financeLeaseLiabilities.value)
    .minus(cashAndMarketableDebtSecurities.value)
    .minus(nonOperatingEquityInvestmentsAtBook.value);

  const provenance = combineProvenance(
    sharesOutstanding.provenance,
    treasuryMethodDilution.provenance,
    price.provenance,
    totalDebt.provenance,
    financeLeaseLiabilities.provenance,
    cashAndMarketableDebtSecurities.provenance,
    nonOperatingEquityInvestmentsAtBook.provenance
  );

  return computedValue(
    {
      marketCap,
      totalDebt: totalDebt.value,
      financeLeaseLiabilities: financeLeaseLiabilities.value,
      cashAndMarketableDebtSecurities: cashAndMarketableDebtSecurities.value,
      nonOperatingEquityInvestmentsAtBook: nonOperatingEquityInvestmentsAtBook.value,
      nonOperatingInvestmentsErrorDirection: input.nonOperatingInvestmentsErrorDirection,
      enterpriseValue,
    },
    provenance
  );
}

// "The equity bridge reverses this exactly" (§3.5) — used by later modules
// (M6 steady-state EV, M7 reverse DCF) to convert an independently derived
// enterprise value back to implied equity value, using the same cash,
// investments, debt and lease figures as the forward bridge above. Never a
// second definition of the same quantity (§9 mistake 18).
export function computeEquityValueFromEnterpriseValue(
  enterpriseValue: Decimal,
  cashAndMarketableDebtSecurities: Decimal,
  nonOperatingEquityInvestmentsAtBook: Decimal,
  totalDebt: Decimal,
  financeLeaseLiabilities: Decimal
): Decimal {
  return enterpriseValue
    .plus(cashAndMarketableDebtSecurities)
    .plus(nonOperatingEquityInvestmentsAtBook)
    .minus(totalDebt)
    .minus(financeLeaseLiabilities);
}
