"use client";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import type { ReactNode } from "react";
import Link from "next/link";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-900 flex flex-col">
      <header className="h-14 flex items-center justify-between px-4 md:px-6 border-b border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-[#ff4d4f] flex items-center justify-center text-white text-xs font-bold">
            UB
          </div>
          <div>
            <div className="text-sm font-semibold">
              Undercover BattleBox – Admin
            </div>
            <div className="text-[11px] text-gray-500">
              Live control panel
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-4 text-xs font-medium">
          <Link href="/admin" className="text-gray-700 hover:text-[#ff4d4f] transition">
            Dashboard
          </Link>
          <Link href="/admin/settings" className="text-gray-700 hover:text-[#ff4d4f] transition">
            Settings
          </Link>
        </nav>
      </header>

      <main className="flex-1 p-4 md:p-6">{children}</main>

      <footer className="text-center text-xs text-gray-400 py-4">
        BattleBox Admin © {new Date().getFullYear()}
      </footer>
    </div>
  );
}
