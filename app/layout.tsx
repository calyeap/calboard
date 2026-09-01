import "./globals.css";
import { PrivacyProvider } from "./components/PrivacyContext";

export const metadata = {
  title: "Calboard",
  description: "Private portfolio tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PrivacyProvider>{children}</PrivacyProvider>
      </body>
    </html>
  );
}
