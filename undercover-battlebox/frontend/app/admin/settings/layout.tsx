"use client";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
export const dynamicParams = false;
export const runtime = "nodejs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
