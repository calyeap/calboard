"use client";

import Link from "next/link";
import { usePrivacy } from "./PrivacyContext";

export function NavBar() {
  const { hidden, toggle } = usePrivacy();
  return (
    <nav className="site-nav">
      <strong className="site-nav__brand">Calboard</strong>
      <Link href="/">Dashboard</Link>
      <Link href="/holdings">Holdings</Link>
      <button type="button" aria-pressed={hidden} onClick={toggle} style={{ marginInlineStart: "auto" }}>
        {hidden ? "Show values" : "Hide values"}
      </button>
    </nav>
  );
}
