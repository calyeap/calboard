import Link from "next/link";
import { NavBar, buttonLinkStyle } from "../components/NavBar";
import { listAccounts } from "@/lib/accounts";

// Always render dynamically — see app/page.tsx (Task 3) for why.
export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const accounts = await listAccounts();

  return (
    <>
      <NavBar />
      <main style={{ fontFamily: "system-ui", padding: "0 2rem 2rem", maxWidth: 900, margin: "0 auto" }}>
        <h1>Holdings</h1>
        {accounts.length === 0 && (
          <>
            <p>No holdings yet.</p>
            <Link href="/accounts/new" style={buttonLinkStyle}>Add your holdings</Link>
          </>
        )}
      </main>
    </>
  );
}
