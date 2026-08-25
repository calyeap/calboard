import Decimal from "decimal.js";

export function toDecimal(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  return new Decimal(value);
}

export function decimalToDb(value: Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toFixed(10);
}
