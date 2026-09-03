import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { PrivacyProvider } from "./components/PrivacyContext";
import { ThemeProvider } from "./components/ThemeContext";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-sans",
});

export const metadata = {
  title: "Calboard",
  description: "Private portfolio tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={ibmPlexSans.variable}>
      <body>
        <ThemeProvider>
          <PrivacyProvider>{children}</PrivacyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
