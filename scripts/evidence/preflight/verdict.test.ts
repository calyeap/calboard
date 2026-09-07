import { describe, it, expect } from "vitest";
import { aggregate } from "./verdict";
import type { CheckResult } from "./types";

const r = (step: string, status: CheckResult["status"], detail = ""): CheckResult => ({
  step,
  status,
  detail,
});

describe("aggregate", () => {
  it("is PASS when every check passed", () => {
    const v = aggregate([r("a", "PASS"), r("b", "PASS")]);
    expect(v.status).toBe("PASS");
    expect(v.failingStep).toBeNull();
  });

  it("is FAIL naming the first failing step", () => {
    const v = aggregate([r("a", "PASS"), r("b", "FAIL", "broke"), r("c", "FAIL", "also broke")]);
    expect(v.status).toBe("FAIL");
    expect(v.failingStep).toBe("b");
  });

  it("is UNKNOWN when nothing failed but something could not be reached", () => {
    const v = aggregate([r("a", "PASS"), r("b", "UNKNOWN", "state not reachable")]);
    expect(v.status).toBe("UNKNOWN");
    expect(v.failingStep).toBe("b");
  });

  it("reports FAIL over UNKNOWN — a wrong render outranks an unreached state", () => {
    const v = aggregate([r("a", "UNKNOWN", "not reachable"), r("b", "FAIL", "broke")]);
    expect(v.status).toBe("FAIL");
    expect(v.failingStep).toBe("b");
  });

  it("is UNKNOWN, not PASS, when there were no checks to run", () => {
    expect(aggregate([]).status).toBe("UNKNOWN");
  });
});
