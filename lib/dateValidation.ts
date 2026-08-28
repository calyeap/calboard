const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// The app's single definition of "today" — the LOCAL system calendar day.
// Used both server-side (isFutureDate) and client-side (every date-input
// default in SetupWizard.tsx / HoldingsEditor.tsx import this directly,
// rather than each re-deriving "today" with its own toISOString() call).
// This app is single-user and localhost-only, so the server process and the
// browser share one machine's timezone — using UTC here would reject a
// legitimately-today date as future for part of every day (see Task 2's
// header note for why).
export function localTodayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function isFutureDate(dateStr: string, now: Date = new Date()): boolean {
  return dateStr > localTodayIso(now);
}

// Normalizes a value read back from a Postgres DATE column to a plain
// "YYYY-MM-DD" string. lib/db.ts's global type parser already keeps DATE
// columns as raw strings, but this helper is defensive against that
// changing, and against any query path that ends up handing back a JS Date
// (node-postgres's undecorated default) — using .toISOString() on a Date
// would convert through UTC and can shift the date by one day for any
// caller running behind UTC, so this reads a Date's own LOCAL
// year/month/day components instead, exactly like localTodayIso above.
export function normalizePgDate(value: string | Date): string {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return value;
}
