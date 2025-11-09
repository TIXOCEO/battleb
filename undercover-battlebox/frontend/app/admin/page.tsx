// app/admin/layout.tsx
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl">
      <body className="min-h-screen bg-[#f5f5f7] text-gray-900">
        <div className="min-h-screen flex flex-col">
          {/* Simple topbar */}
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
            <span className="text-[11px] text-gray-500">
              Connected as <strong>Admin</strong>
            </span>
          </header>

          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
