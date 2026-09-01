// Split out of lib/assets.ts: this file must stay free of any server-only
// import (lib/db.ts -> pg -> Node's `fs`) so client components can import
// formatAssetClass without bundling the database driver into the browser.
export type AssetClass = "equity" | "etf" | "crypto";

const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  equity: "Equity",
  etf: "ETF",
  crypto: "Crypto",
};

export function formatAssetClass(assetClass: AssetClass): string {
  return ASSET_CLASS_LABELS[assetClass];
}
