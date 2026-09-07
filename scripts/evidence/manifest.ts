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
 */
export function buildManifest(args: ManifestArgs): unknown {
  const targets: Record<string, unknown> = {};
  const names = new Set([...args.captured.keys()].map((k) => k.split("|")[0]));

  for (const target of names) {
    const widths: Record<string, unknown> = {};
    for (const w of WIDTHS) {
      const d = args.captured.get(`${target}|${w}`);
      if (d === undefined) continue;
      widths[String(w)] = {
        screenshot: `${target}-${w}.png`,
        nodes: d.nodes.length,
        errors: d.errors,
      };
    }
    targets[target] = { widths };
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
