import { notFound } from "next/navigation";
import { assembleAnalysisResult } from "@/lib/analyzer/assemble";
import { MSFT_FIXTURE } from "@/lib/analyzer/fixtures/msft";
import { OKLO_FIXTURE } from "@/lib/analyzer/fixtures/oklo";
import { AnalyzerShell } from "@/app/components/AnalyzerShell";
import { AnalyzerReport } from "@/app/components/AnalyzerReport";

// Milestone 6 — no SEC acquisition layer exists yet (Milestone 8), so this
// route serves the two Milestone 5 validation fixtures rather than a live
// ticker lookup. Each visit re-assembles the AnalysisResult fresh from the
// fixture's raw inputs (no caching, no persistence) — this route renders
// the object; it never recomputes M1-M16 logic itself.
const FIXTURES = {
  MSFT: MSFT_FIXTURE,
  OKLO: OKLO_FIXTURE,
} as const;

export function generateStaticParams() {
  return Object.keys(FIXTURES).map((ticker) => ({ ticker: ticker.toLowerCase() }));
}

export default async function AnalyzerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const key = ticker.toUpperCase() as keyof typeof FIXTURES;
  const fixture = FIXTURES[key];
  if (!fixture) notFound();

  const result = assembleAnalysisResult(fixture);

  return (
    <AnalyzerShell>
      <AnalyzerReport result={result} />
    </AnalyzerShell>
  );
}
