import { AnalyzerShell } from "@/app/components/AnalyzerShell";
import { AnalyzerEntry } from "@/app/components/AnalyzerEntry";

// Screen 1 — the analyzer's entry point (§2 Step 1, design route table).
//
// This route holds no [runId] because no run exists yet: the run is created
// when the analyst confirms the resolved company, which is what makes Screen 1
// a step rather than a form field (design:121).
export default async function AnalyzerEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ unavailablefixture?: string }>;
}) {
  const { unavailablefixture } = await searchParams;

  return (
    <AnalyzerShell>
      <AnalyzerEntry fixtureMissing={unavailablefixture} />
    </AnalyzerShell>
  );
}
