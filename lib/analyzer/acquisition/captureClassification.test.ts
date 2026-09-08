import { describe, it, expect, beforeEach } from "vitest";
import { acquireCompany, __resetAcquisitionCache } from "./provider";
import { sectorClassificationFromSic, industryClassificationFromSic } from "./gate0Inputs";

// ---------------------------------------------------------------------------
// THE TEST-SUITE GAP THIS MILESTONE MUST NOT SURVIVE.
//
// `fromCapture` passed null for sicDescription, so offline mode — which is how
// the whole suite runs — had never once seen a populated classification. Gate 0
// failed closed on every captured run, every assertion downstream was written
// against that refusal, and no test in 1190 could have caught a sector test
// that never fires or an input that is always null.
//
// "A test environment that cannot reproduce the live one is a check that cannot
// fail."
//
// The captures now carry the SIC code the submissions endpoint returned at
// capture time, so the populated path is the path the suite exercises.
// ---------------------------------------------------------------------------

describe("the committed captures carry a real classification", () => {
  beforeEach(() => {
    __resetAcquisitionCache();
  });

  it("MSFT's capture carries its SIC code, not null", async () => {
    const acquired = await acquireCompany("MSFT", { price: null, source: "CAPTURE" });

    expect(acquired.sic).not.toBeNull();
    // 7372, Services-Prepackaged Software — read off EDGAR at capture time.
    expect(acquired.sic).toBe("7372");
    expect(acquired.sicDescription).toBe("Services-Prepackaged Software");
  });

  it("OKLO's capture carries its SIC code, not null", async () => {
    const acquired = await acquireCompany("OKLO", { price: null, source: "CAPTURE" });

    expect(acquired.sic).not.toBeNull();
    // 4911, Electric Services.
    expect(acquired.sic).toBe("4911");
  });

  it("MSFT's captured classification passes Gate 0's sector test", async () => {
    // The populated case, which is the whole point: a classification that is
    // present AND not asset-based. Before this the suite could only ever see
    // "absent".
    const acquired = await acquireCompany("MSFT", { price: null, source: "CAPTURE" });

    const sector = sectorClassificationFromSic(acquired.sic);
    expect(sector).not.toBeNull();
    expect(sector).not.toBe("Financials");
    expect(sector).not.toBe("Real Estate");
  });

  it("OKLO's captured classification is not reserve-based extraction", async () => {
    // V6 needs OKLO through Gate 0 to reach the pre-revenue module.
    const acquired = await acquireCompany("OKLO", { price: null, source: "CAPTURE" });

    const industry = industryClassificationFromSic(acquired.sic);
    expect(industry).not.toBeNull();
    expect(industry).not.toBe("Oil & Gas Exploration & Production");
    expect(industry).not.toBe("Mining");
  });
});
