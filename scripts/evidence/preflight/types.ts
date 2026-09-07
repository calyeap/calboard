/**
 * One captured node, field-for-field the shape `capture-m7-gate.js` emits.
 *
 * `cls` is nullable because the existing probe writes
 * `getAttribute("class") || null` — an unclassed element carries null, not "".
 */
export interface ProbeNode {
  i: number;
  tag: string;
  cls: string | null;
  type: string | null;
  checked: boolean | null;
  disabled: boolean | null;
  ariaExpanded: string | null;
  offsetTop: number;
  scrollOverflow: boolean;
  clientW: number;
  scrollW: number;
  text: string;
  box: { x: number; y: number; w: number; h: number; right: number };
  style: Record<string, string>;
}

/** One captured page at one width. */
export interface ProbeDocument {
  url: string;
  title: string;
  viewport: { w: number; h: number };
  docOverflow: boolean;
  bodyText: string;
  nodes: ProbeNode[];
  /** Console and page errors seen while this page loaded. */
  errors: string[];
}

export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface CheckResult {
  /** The step name reported when this check decides the verdict. */
  step: string;
  status: CheckStatus;
  /** Why. Always populated for FAIL and UNKNOWN. */
  detail: string;
}
