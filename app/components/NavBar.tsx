import Link from "next/link";

export const buttonLinkStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "0.5rem 1rem",
  background: "#111",
  color: "#fff",
  textDecoration: "none",
  borderRadius: 4,
};

export function NavBar() {
  return (
    <nav
      style={{
        display: "flex",
        gap: "1.5rem",
        alignItems: "center",
        padding: "1rem 2rem",
        borderBottom: "1px solid #ddd",
        marginBottom: "2rem",
        fontFamily: "system-ui",
      }}
    >
      <strong>Calboard</strong>
      <Link href="/">Dashboard</Link>
      <Link href="/holdings">Holdings</Link>
    </nav>
  );
}
