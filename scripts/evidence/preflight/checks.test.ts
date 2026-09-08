import { describe, it, expect } from "vitest";
import {
  checkRendered,
  checkOverflow,
  checkFont,
  checkConsoleErrors,
  checkStatesAppeared,
  checkContinueGated,
} from "./checks";
import type { ProbeDocument, ProbeNode } from "./types";

function node(over: Partial<ProbeNode> = {}): ProbeNode {
  return {
    i: 0, tag: "div", cls: null, type: null, checked: null, disabled: null,
    ariaExpanded: null, offsetTop: 0, scrollOverflow: false, clientW: 700,
    scrollW: 700, text: "", box: { x: 0, y: 0, w: 700, h: 10, right: 700 },
    style: {}, ...over,
  };
}

function doc(over: Partial<ProbeDocument> = {}): ProbeDocument {
  return {
    url: "http://127.0.0.1:3000/analyzer", title: "Calboard",
    viewport: { w: 720, h: 1200 }, docOverflow: false, bodyText: "",
    nodes: [node()], errors: [], ...over,
  };
}

const PLEX =
  'var(--font-ibm-plex-sans), "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

describe("checkRendered", () => {
  it("PASSes when every requested target has a document at every width", () => {
    const captured = new Map([["s1-resolved|720", doc()], ["s1-resolved|1024", doc()]]);
    expect(checkRendered(["s1-resolved"], [720, 1024], captured).status).toBe("PASS");
  });

  it("FAILs naming the target and width that is missing", () => {
    const captured = new Map([["s1-resolved|720", doc()]]);
    const r = checkRendered(["s1-resolved"], [720, 1024], captured);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("s1-resolved");
    expect(r.detail).toContain("1024");
  });

  it("FAILs when a document rendered but carries no nodes", () => {
    const captured = new Map([["s1-resolved|720", doc({ nodes: [] })]]);
    expect(checkRendered(["s1-resolved"], [720], captured).status).toBe("FAIL");
  });
});

describe("checkOverflow", () => {
  it("PASSes when the document and every node fit", () => {
    expect(checkOverflow("s1-resolved", doc()).status).toBe("PASS");
  });

  it("FAILs on document overflow", () => {
    const r = checkOverflow("s1-resolved", doc({ docOverflow: true }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("document");
  });

  it("FAILs on a node whose scrollWidth exceeds its clientWidth", () => {
    const wide = node({ cls: "factcard", clientW: 700, scrollW: 880, scrollOverflow: true });
    const r = checkOverflow("s2-facts-msft", doc({ nodes: [wide] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("factcard");
    expect(r.detail).toContain("880");
  });

  it("does not fire on sub-pixel rounding the probe already tolerated", () => {
    // The probe applies a half-pixel tolerance, so a node 0.4px over reports
    // scrollOverflow false. The check must trust that verdict rather than
    // recomputing strictly and manufacturing a FAIL the layout does not have.
    const hair = node({ cls: "wrap", clientW: 657, scrollW: 657.4, scrollOverflow: false });
    expect(checkOverflow("s1-resolved", doc({ nodes: [hair] })).status).toBe("PASS");
  });

  it("names an unclassed node by its tag rather than printing null", () => {
    const bare = node({ cls: null, tag: "table", scrollOverflow: true, clientW: 600, scrollW: 900 });
    const r = checkOverflow("s2-facts-msft", doc({ nodes: [bare] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("table");
    expect(r.detail).not.toContain("null");
  });
});

describe("checkFont", () => {
  it("PASSes when .cb-analyzer declares the Plex stack", () => {
    const root = node({ cls: "cb-analyzer", style: { fontFamily: PLEX } });
    expect(checkFont("s1-resolved", doc({ nodes: [root] })).status).toBe("PASS");
  });

  it("FAILs when .cb-analyzer computes the system stack instead", () => {
    // The real pre-1ceb2f5 regression, reproduced from the 17:27 manual capture.
    const root = node({ cls: "cb-analyzer", style: { fontFamily: SYSTEM } });
    const r = checkFont("s1-resolved", doc({ nodes: [root] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("IBM Plex Sans");
  });

  it("FAILs rather than passing vacuously when no .cb-analyzer node exists", () => {
    const r = checkFont("s1-resolved", doc({ nodes: [node({ cls: "wrap" })] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("cb-analyzer");
  });

  it("ignores html, which is never styled and always computes Times New Roman", () => {
    const html = node({ tag: "html", style: { fontFamily: '"Times New Roman"' } });
    const root = node({ cls: "cb-analyzer", style: { fontFamily: PLEX } });
    expect(checkFont("s1-resolved", doc({ nodes: [html, root] })).status).toBe("PASS");
  });

  it("matches cb-analyzer as a whole class token, not a substring", () => {
    const decoy = node({ cls: "cb-analyzer-footer", style: { fontFamily: SYSTEM } });
    const root = node({ cls: "cb-analyzer", style: { fontFamily: PLEX } });
    expect(checkFont("s1-resolved", doc({ nodes: [decoy, root] })).status).toBe("PASS");
  });
});

describe("checkConsoleErrors", () => {
  it("PASSes on a clean page", () => {
    expect(checkConsoleErrors("s1-resolved", doc()).status).toBe("PASS");
  });

  it("FAILs and quotes the first error", () => {
    const r = checkConsoleErrors("s1-resolved", doc({ errors: ["TypeError: x is not a function"] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("TypeError");
  });
});

describe("checkStatesAppeared", () => {
  it("PASSes when the expected marker is in the body text", () => {
    const d = doc({ bodyText: "Unsupported — not an operating company" });
    const r = checkStatesAppeared("s1-unsupported", "Unsupported — not an operating company", d);
    expect(r.status).toBe("PASS");
  });

  it("FAILs when the page loaded but the state never appeared", () => {
    const d = doc({ bodyText: "Step 1 — Ticker entry and identity resolution" });
    const r = checkStatesAppeared("s1-unsupported", "Unsupported — not an operating company", d);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("Unsupported");
  });

  it("PASSes when the marker is present but upper-cased by CSS text-transform", () => {
    // app/globals.css uppercases the state-name span; document.body.innerText
    // reflects that transform, so the captured bodyText is upper-cased even
    // though config.ts's STATE_MARKERS stay in their source casing.
    const d = doc({ bodyText: "UNKNOWN — NO PROVIDER EVIDENCE FOR ZXQY" });
    const r = checkStatesAppeared("s1-unknown", "Unknown — no provider evidence for ZXQY", d);
    expect(r.status).toBe("PASS");
  });

  it("still FAILs when the marker's words are entirely absent, case-insensitivity notwithstanding", () => {
    const d = doc({ bodyText: "Step 1 — Ticker entry and identity resolution" });
    const r = checkStatesAppeared("s1-unknown", "Unknown — no provider evidence for ZXQY", d);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("Unknown");
  });
});

describe("checkContinueGated", () => {
  it("PASSes when Continue is disabled and a reason line is present", () => {
    const button = node({ tag: "button", cls: "act", text: "Continue to gates", disabled: true });
    const reason = node({
      tag: "span",
      cls: "reason",
      text: "1 material fact still undecided — Continue is unavailable until every fact carries a decision.",
    });
    const d = doc({ nodes: [button, reason] });
    expect(checkContinueGated("s2-facts-msft-undecided", d).status).toBe("PASS");
  });

  it("FAILs naming the step when Continue is enabled on an undecided capture", () => {
    const button = node({ tag: "button", cls: "act", text: "Continue to gates", disabled: false });
    const d = doc({ nodes: [button] });
    const r = checkContinueGated("s2-facts-msft-undecided", d);
    expect(r.status).toBe("FAIL");
    expect(r.step).toBe("Continue to gates disabled with a reason on the undecided capture");
    expect(r.detail).toContain("enabled");
  });

  it("FAILs when no Continue control is present in the capture", () => {
    const d = doc({ nodes: [node({ tag: "div", text: "something else" })] });
    const r = checkContinueGated("s2-facts-msft-undecided", d);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("no");
    expect(r.detail).toContain("Continue to gates");
  });

  it("FAILs when Continue is disabled but no reason line accompanies it", () => {
    const button = node({ tag: "button", cls: "act", text: "Continue to gates", disabled: true });
    const d = doc({ nodes: [button] });
    const r = checkContinueGated("s2-facts-msft-undecided", d);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("no reason line");
  });

  it("is not fooled by the decided screen's enabled Continue link carrying the same label", () => {
    // The decided screen's control is an <a>, not a <button> — the probe's
    // `disabled` read (`el.disabled`) is `undefined` on an anchor, which the
    // probe already normalises to `null`. A check that treated null as
    // "not disabled === true, so FAIL" would be correct by accident; this
    // proves the FAIL is for the right reason on a button, not a coincidence
    // of node shape.
    const link = node({ tag: "a", cls: "act", text: "Continue to gates", disabled: null });
    const r = checkContinueGated("s2-facts-msft-undecided", doc({ nodes: [link] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("no");
  });
});
