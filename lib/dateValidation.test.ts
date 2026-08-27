import { describe, it, expect } from "vitest";
import { isValidCalendarDate, isFutureDate, localTodayIso, normalizePgDate } from "./dateValidation";

describe("localTodayIso", () => {
  it("formats a Date's own local year/month/day, not its UTC ones", () => {
    // Constructed via local components (JS Date's (y, m, d, h, ...) constructor
    // always uses the machine's local timezone) — this must round-trip exactly,
    // regardless of what timezone the machine running this test is in.
    const now = new Date(2026, 7, 26, 14, 30); // Aug 26, 2026, 14:30 local time
    expect(localTodayIso(now)).toBe("2026-08-26");
  });
});

describe("isFutureDate", () => {
  it("returns true for a date clearly in the future", () => {
    expect(isFutureDate("2099-01-01")).toBe(true);
  });

  it("returns false for today", () => {
    const now = new Date(2026, 7, 26, 12, 0);
    expect(isFutureDate("2026-08-26", now)).toBe(false);
  });

  it("returns false for a past date", () => {
    const now = new Date(2026, 7, 26, 12, 0);
    expect(isFutureDate("2026-08-25", now)).toBe(false);
  });

  it("returns true for tomorrow relative to a fixed now", () => {
    const now = new Date(2026, 7, 26, 23, 59);
    expect(isFutureDate("2026-08-27", now)).toBe(true);
  });

  it("does not reject local 'today' as future shortly after local midnight (the UTC-boundary bug)", () => {
    // 00:05 LOCAL time — constructed via setHours, which operates in the
    // machine's own local timezone. In any timezone ahead of UTC this
    // moment's UTC calendar date is still the PREVIOUS day; the old
    // UTC-based implementation would have compared "today" against that
    // earlier UTC day and wrongly flagged the real local today as future.
    const now = new Date();
    now.setHours(0, 5, 0, 0);
    const localToday = localTodayIso(now);
    expect(isFutureDate(localToday, now)).toBe(false);
  });
});

describe("isValidCalendarDate (regression, unchanged)", () => {
  it("still rejects a malformed date", () => {
    expect(isValidCalendarDate("2026/08/26")).toBe(false);
  });
});

describe("normalizePgDate", () => {
  it("passes through an already-string DATE value unchanged", () => {
    expect(normalizePgDate("2026-03-14")).toBe("2026-03-14");
  });

  it("formats a Date object using its own LOCAL year/month/day, not a UTC conversion", () => {
    const value = new Date(2026, 2, 14, 0, 0); // local midnight, March 14 2026
    expect(normalizePgDate(value)).toBe("2026-03-14");
  });
});
