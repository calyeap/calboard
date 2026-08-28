import "./globals.css";

export const metadata = {
  title: "Calboard",
  description: "Private portfolio tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
