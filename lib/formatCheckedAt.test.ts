import { describe, it, expect } from "vitest";
import { formatCheckedAt, formatCheckedTime } from "./formatCheckedAt";

describe("formatCheckedAt", () => {
  it("formats as 'D Mon, HH:MM SGT' in the Singapore timezone", () => {
    // 2026-08-29T13:04:00Z = 2026-08-29 21:04 SGT (UTC+8, no DST)
    const result = formatCheckedAt(new Date("2026-08-29T13:04:00Z"));
    expect(result).toBe("29 Aug, 21:04 SGT");
  });
});

describe("formatCheckedTime", () => {
  it("formats as 'HH:MM SGT', with no date", () => {
    const result = formatCheckedTime(new Date("2026-08-29T13:04:00Z"));
    expect(result).toBe("21:04 SGT");
  });
});
