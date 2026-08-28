import Link from "next/link";

export function NavBar() {
  return (
    <nav className="site-nav">
      <strong className="site-nav__brand">Calboard</strong>
      <Link href="/">Dashboard</Link>
      <Link href="/holdings">Holdings</Link>
    </nav>
  );
}
