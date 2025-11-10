import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Undercover BattleBox – Admin",
  description: "TikTok Live Survival Arena Control Panel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
