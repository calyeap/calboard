// scripts/evidence/manifest.ts
import { WIDTHS } from "./config";
import type { ProbeDocument } from "./preflight/types";
import type { Verdict } from "./preflight/verdict";

export interface ManifestArgs {
  baseUrl: string;
  captured: ReadonlyMap<string, ProbeDocument>;
  verdict: Verdict;
  runIds: Record<string, string>;
  unknowns: { target: string; reason: string }[];
}

/**
 * The manifest, additive to the shape DESIGN already reads.
 *
 * `base`, `captured`, `widths` and `targets` keep their existing names and
 * meaning, so nothing about how the archive is read has to change. `preflight`
 * and `runs` are new.
 *
 * Each target also carries `url` — the route captured, as an absolute URL
 * (`ProbeDocument.url`, i.e. `location.href` at capture time), restored from
 * the instrument this ports (`C:\Users\Calvin\m7gate\capture-m7-gate.js`,
 * which wrote `targets[label] = { url, ticker, widths }`). It is the field
 * most worth keeping because the run IDs are new on every run — it is what
 * tells a reviewer which run a screenshot came from, and it disambiguates
 * `s2-facts-msft` from `s2-facts-oklo` (different runs, different tickers),
 * which otherwise share a state marker. It does not disambiguate every
 * same-marker pair, though: `s2-facts-msft-undecided` and `s2-facts-msft`
 * are the same run and the same route, captured twice, so they share both
 * marker and `url` — there the target name itself is what tells them apart.
 * `ticker` was deliberately not restored: it would only add information for
 * the two per-run targets, and for those the run ID is already in `url` and
 * in the top-level `runs` map — a second, narrower field carrying the same
 * fact was not worth the surface.
 */
export function buildManifest(args: ManifestArgs): unknown {
  const targets: Record<string, unknown> = {};
  const names = new Set([...args.captured.keys()].map((k) => k.split("|")[0]));

  for (const target of names) {
    const widths: Record<string, unknown> = {};
    let url: string | undefined;
    for (const w of WIDTHS) {
      const d = args.captured.get(`${target}|${w}`);
      if (d === undefined) continue;
      if (url === undefined) url = d.url;
      widths[String(w)] = {
        screenshot: `${target}-${w}.png`,
        nodes: d.nodes.length,
        errors: d.errors,
      };
    }
    targets[target] = { url: url ?? null, widths };
  }
  for (const u of args.unknowns) targets[u.target] = { skipped: u.reason };

  return {
    base: args.baseUrl,
    captured: new Date().toISOString(),
    widths: [...WIDTHS],
    preflight: {
      verdict: args.verdict.status,
      failingStep: args.verdict.failingStep,
      checks: args.verdict.results,
    },
    // Recorded, never deleted. Runs are disposable by R7; these are listed so
    // clearing them stays Calvin's decision and not the runner's.
    runs: args.runIds,
    targets,
  };
}
