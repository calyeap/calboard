import "./globals.css";
import { PrivacyProvider } from "./components/PrivacyContext";
import { ThemeProvider } from "./components/ThemeContext";

export const metadata = {
  title: "Calboard",
  description: "Private portfolio tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <PrivacyProvider>{children}</PrivacyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
