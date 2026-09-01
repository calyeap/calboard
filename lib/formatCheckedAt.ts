// "Data checked TIME SGT" — Singapore has no DST (fixed UTC+8), so the
// abbreviation is safe to hardcode rather than trust Intl's zone-name output.
// Shared by both `/` and `/holdings` — both routes show the same "Data
// checked" line beside the same global PriceRefreshControl.
export function formatCheckedAt(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} SGT`;
}
