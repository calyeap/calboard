import { SetupWizard } from "./SetupWizard";

// The setup wizard suppresses the persistent NavBar while active (spec
// §2.1) — no <NavBar /> here. The route path is legacy; nothing
// user-facing on this page says "account".
export default function NewPortfolioSetupPage() {
  return (
    <main className="page-shell page-shell--narrow">
      <SetupWizard />
    </main>
  );
}
