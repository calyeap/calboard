import type { Profile } from "./types";

// The §6.3 profile table's own wording, as the interface shows it. Held here
// rather than in a route module because a Next.js page may only export a fixed
// set of names, and because Step 6 records the label the analyst actually saw.
export const PROFILE_LABELS: Record<Profile, string> = {
  MATURE_PROFITABLE_STABLE_FCF: "Mature, profitable, stable FCF",
  HIGH_GROWTH_PROFITABLE_UNCERTAIN_DURABILITY: "High-growth, profitable, uncertain durability",
  PRE_REVENUE_UNPROFITABLE: "Pre-revenue / unprofitable",
  // Reachable only through the Gate 0 override, never the profile selector
  // (design §5.3). Validated on nothing (§1.2).
  ASSET_BASED: "Asset-based — not validated",
};
