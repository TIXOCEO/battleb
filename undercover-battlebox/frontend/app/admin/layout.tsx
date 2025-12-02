import type { ReactNode } from "react";
import Link from "next/link";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl" className="h-full">
      <body className="min-h-screen bg-[#050509] text-slate-100 antialiased">
        <div className="min-h-screen flex flex-col">

          {/* TOPBAR */}
          <header className="sticky top-0 z-40 border-b border-white/5 bg-[#050509]/90 backdrop-blur">
            <div className="h-14 flex items-center justify-between px-3 md:px-6">

              {/* BRAND / TITLE */}
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#ff4d4f] to-[#ff7a45] flex items-center justify-center text-[11px] font-black tracking-tight shadow-[0_0_18px_rgba(255,77,79,0.7)]">
                    UB
                  </div>
                  {/* subtle neon ring */}
                  <div className="pointer-events-none absolute -inset-1 rounded-2xl border border-[#ff4d4f]/40 blur-sm opacity-60" />
                </div>

                <div className="leading-tight">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <span>Undercover BattleBox</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 text-emerald-300 uppercase tracking-wider">
                      Admin console
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Live control • arena · wachtrij · twists
                  </div>
                </div>
              </div>

              {/* NAVIGATION */}
              <nav className="flex items-center gap-1 text-[11px] font-medium">
                <Link
                  href="/admin"
                  className="px-3 py-1.5 rounded-full border border-transparent text-slate-300 hover:text-white hover:border-[#ff4d4f]/70 hover:bg-[#ff4d4f]/10 transition-colors"
                >
                  Dashboard
                </Link>

                <Link
                  href="/admin/settings"
                  className="px-3 py-1.5 rounded-full border border-transparent text-slate-300 hover:text-white hover:border-[#0fffd7]/70 hover:bg-[#0fffd7]/10 transition-colors"
                >
                  Settings
                </Link>
              </nav>
            </div>
          </header>

          {/* MAIN CONTENT */}
          <main className="flex-1 w-full max-w-6xl mx-auto px-3 md:px-6 py-4 md:py-6">
            {/* globale spacing; de echte panels gaan we zo in de page componenten strak trekken */}
            {children}
          </main>

          {/* FOOTER */}
          <footer className="border-t border-white/5 py-3 text-[11px] text-center text-slate-500">
            BattleBox Admin · Engine Control · © {new Date().getFullYear()}
          </footer>
        </div>
      </body>
    </html>
  );
}
