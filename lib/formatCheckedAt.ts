// Singapore has no DST (fixed UTC+8), so the "SGT" abbreviation is safe to
// hardcode rather than trust Intl's zone-name output.
function checkedParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: get("day"), month: get("month"), hour: get("hour"), minute: get("minute") };
}

// "Data checked TIME SGT" — shared by both `/` and `/holdings` via the same
// global PriceRefreshControl.
export function formatCheckedAt(now: Date): string {
  const p = checkedParts(now);
  return `${p.day} ${p.month}, ${p.hour}:${p.minute} SGT`;
}

// "HH:MM SGT" only — /holdings merges this into its single "Prices as of …
// close · checked HH:MM SGT" line, which already carries the date once.
export function formatCheckedTime(now: Date): string {
  const p = checkedParts(now);
  return `${p.hour}:${p.minute} SGT`;
}
