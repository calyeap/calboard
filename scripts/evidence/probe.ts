// scripts/evidence/probe.ts

/**
 * The in-page probe, evaluated in the browser.
 *
 * A port of the PROBE in C:\Users\Calvin\m7gate\capture-m7-gate.js — the
 * instrument DESIGN's readings have been taken with. The field names, the node
 * selector, the tolerances and the caps are all that script's, deliberately:
 * this runner replaces the manual round trip around the instrument, not the
 * instrument. Extending the shape is safe; changing what it measures is not.
 *
 * Serialised into the page by Playwright, so it must close over nothing.
 */
export function probeInPage(): unknown {
  const PROPS = [
    "display", "flexWrap", "flexDirection", "gap", "columnGap", "rowGap",
    "fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing",
    "textTransform", "color", "backgroundColor", "borderStyle", "borderWidth",
    "borderColor", "borderLeftStyle", "borderLeftWidth", "borderLeftColor",
    "padding", "margin", "maxWidth", "width", "height", "opacity", "cursor",
    "textDecorationLine",
  ];

  // Deliberately not "*". This is the existing instrument's selector: the
  // controls that carry state, the headings that carry structure, and anything
  // with a class — which is what picks up html, .cb-analyzer and every styled
  // container. Widening it to "*" would change every archive DESIGN reads.
  const SEL = [
    "fieldset", "legend", "label", "input", "select", "button", "details", "summary",
    "table", "th", "h1", "h2", "h3", "h4", "[class]",
  ].join(",");

  const nodes: unknown[] = [];
  const seen = new Set<Element>();

  document.querySelectorAll(SEL).forEach((raw, i) => {
    if (seen.has(raw)) return;
    seen.add(raw);

    const el = raw as HTMLElement;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // not rendered

    const cs = getComputedStyle(el);
    const style: Record<string, string> = {};
    for (const p of PROPS) style[p] = (cs as unknown as Record<string, string>)[p];

    const input = el as HTMLInputElement;
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();

    nodes.push({
      i,
      tag: el.tagName.toLowerCase(),
      cls: el.getAttribute("class") || null,
      type: el.getAttribute("type") || null,
      checked: el.tagName === "INPUT" ? input.checked : null,
      disabled: input.disabled === undefined ? null : input.disabled,
      ariaExpanded: el.getAttribute("aria-expanded"),
      offsetTop: el.offsetTop,
      // Half-pixel tolerance, both here and on docOverflow below. Without it,
      // sub-pixel layout rounding reports overflow the layout does not have —
      // which would FAIL a known-good baseline and make the runner the thing
      // that is wrong.
      scrollOverflow: el.scrollWidth > el.clientWidth + 0.5,
      clientW: el.clientWidth,
      scrollW: el.scrollWidth,
      text: text.slice(0, 200),
      box: {
        x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1),
        h: +r.height.toFixed(1), right: +r.right.toFixed(1),
      },
      style,
    });
  });

  return {
    url: location.href,
    title: document.title,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    docOverflow: document.documentElement.scrollWidth > window.innerWidth + 0.5,
    bodyText: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 6000),
    nodes,
  };
}
