import Link from "next/link";

// Milestone 6 — no ticker search/acquisition yet (Milestone 8), so this is
// a plain index of the two Milestone 5 validation fixtures available to
// view, not a real analyzer entry point.
export default function AnalyzerIndexPage() {
  return (
    <main style={{ padding: "32px 24px", maxWidth: "640px", margin: "0 auto" }}>
      <h1>Stock Analyzer v1 — fixture reports</h1>
      <p>
        No ticker acquisition exists yet (Milestone 8). These two links render the Milestone 5 validation fixtures
        through the Milestone 6 report renderer.
      </p>
      <ul>
        <li>
          <Link href="/analyzer/msft">MSFT — mature, profitable, stable FCF</Link>
        </li>
        <li>
          <Link href="/analyzer/oklo">OKLO — pre-revenue / unprofitable</Link>
        </li>
      </ul>
    </main>
  );
}
