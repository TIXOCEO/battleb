import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Undercover BattleBox",
  description: "TikTok Live Survival Arena",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body className="bg-black text-white m-0 p-0 font-sans">
        {children}
      </body>
    </html>
  );
}
