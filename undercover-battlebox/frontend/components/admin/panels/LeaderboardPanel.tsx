"use client";

import React from "react";
import Panel from "@/components/admin/ui/Panel";
import SectionHeader from "@/components/admin/ui/SectionHeader";
import Button from "@/components/admin/ui/Button";

export default function LeaderboardPanel({
  activeLbTab,
  setActiveLbTab,
  playerLeaderboard,
  gifterLeaderboard,
  fmt,
}: any) {
  return (
    <Panel>
      <SectionHeader 
        title="Leaderboards" 
        subtitle="Spelers • Gifters" 
      />

      {/* TABS */}
      <div className="flex gap-2 mb-4">
        <Button
          variant={activeLbTab === "players" ? "primary" : "ghost"}
          onClick={() => setActiveLbTab("players")}
          className="px-5"
        >
          Players
        </Button>

        <Button
          variant={activeLbTab === "gifters" ? "primary" : "ghost"}
          onClick={() => setActiveLbTab("gifters")}
          className="px-5"
        >
          Gifters
        </Button>
      </div>

      {/* PLAYERS LB */}
      {activeLbTab === "players" && (
        <div className="max-h-80 overflow-y-auto pr-1">
          <h3 className="text-md font-semibold text-slate-200 mb-1">
            Player Leaderboard
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Diamanten ontvangen (total_score)
          </p>

          {playerLeaderboard.length ? (
            <>
              {playerLeaderboard.map((p: any, idx: number) => (
                <div
                  key={idx}
                  className="border-b border-[#2A3038] py-1.5 flex justify-between text-sm"
                >
                  <div className="text-slate-200">
                    <span className="text-xs text-slate-500 mr-2 font-mono">
                      #{idx + 1}
                    </span>
                    {p.display_name} (@{p.username})
                  </div>

                  <div className="font-semibold text-slate-200">
                    {fmt(p.total_score)} 💎
                  </div>
                </div>
              ))}

              <div className="text-right mt-3 text-slate-300 font-bold">
                Totaal:{" "}
                {fmt(
                  playerLeaderboard.reduce(
                    (acc: any, p: any) => acc + (p.total_score || 0),
                    0
                  )
                )}{" "}
                💎
              </div>
            </>
          ) : (
            <div className="text-slate-500 text-sm italic mt-2">
              Geen spelers gevonden.
            </div>
          )}
        </div>
      )}

      {/* GIFTERS LB */}
      {activeLbTab === "gifters" && (
        <div className="max-h-80 overflow-y-auto pr-1">
          <h3 className="text-md font-semibold text-slate-200 mb-1">
            Gifter Leaderboard
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Diamanten verstuurd
          </p>

          {gifterLeaderboard.length ? (
            <>
              {gifterLeaderboard.map((g: any, idx: number) => (
                <div
                  key={idx}
                  className="border-b border-[#2A3038] py-1.5 flex justify-between text-sm"
                >
                  <div className="text-slate-200">
                    <span className="text-xs text-slate-500 mr-2 font-mono">
                      #{idx + 1}
                    </span>
                    {g.display_name} (@{g.username})
                  </div>

                  <div className="font-semibold text-slate-200">
                    {fmt(g.total_diamonds)} 💎
                  </div>
                </div>
              ))}

              <div className="text-right mt-3 text-slate-300 font-bold">
                Totaal:{" "}
                {fmt(
                  gifterLeaderboard.reduce(
                    (acc: any, g: any) => acc + (g.total_diamonds || 0),
                    0
                  )
                )}{" "}
                💎
              </div>
            </>
          ) : (
            <div className="text-slate-500 text-sm italic mt-2">
              Geen gifters gevonden.
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
