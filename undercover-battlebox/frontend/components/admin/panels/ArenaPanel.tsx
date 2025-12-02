"use client";

import React from "react";
import Panel from "@/components/admin/ui/Panel";
import SectionHeader from "@/components/admin/ui/SectionHeader";
import Badge from "@/components/admin/ui/Badge";
import Button from "@/components/admin/ui/Button";

export default function ArenaPanel({
  arena,
  players,
  fmt,
  hostDiamonds,
  openConfirm,
}: any) {
  return (
    <Panel>
      <SectionHeader title="Arena" subtitle="Actieve spelers & status" />

      {/* HOST DIAMONDS */}
      <div className="flex justify-end mb-3">
        <div className="px-3 py-1 bg-[#4E97FF] border border-[#3375DA] rounded-[4px] text-xs font-semibold text-white">
          Host: {fmt(hostDiamonds)} 💎
        </div>
      </div>

      {/* ROUND STATUS */}
      <p className="text-sm text-slate-400 mb-4">
        {arena
          ? `Ronde #${arena.round} • ${arena.type} • ${arena.status}`
          : "Geen ronde actief"}
      </p>

      {/* GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {players.length ? (
          players.map((p: any, idx: number) => (
            <div
              key={p.id}
              className="relative bg-[#13161C] border border-[#2A3038] rounded-[4px] p-3 shadow-sm"
            >
              {/* REMOVE BUTTON */}
              <button
                onClick={() => {
                  const formatted = p.username.startsWith("@")
                    ? p.username
                    : `@${p.username}`;

                  openConfirm({
                    message: `Weet je zeker dat je ${formatted} permanent wilt verwijderen?`,
                    username: formatted,
                    action: "removeFromArenaPermanent",
                  });
                }}
                className="absolute top-1 right-1 text-[10px] bg-[#FF4D4F] text-white px-1.5 py-0.5 rounded-[3px]"
              >
                ✕
              </button>

              {/* TOP ROW */}
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-200">#{idx + 1}</span>

                <Badge
                  color={
                    p.positionStatus === "immune"
                      ? "green"
                      : p.positionStatus === "danger"
                      ? "yellow"
                      : p.positionStatus === "elimination"
                      ? "red"
                      : "default"
                  }
                >
                  {p.positionStatus}
                </Badge>
              </div>

              {/* NAME */}
              <div className="font-semibold text-slate-200 truncate mt-1">
                {p.display_name} (@{p.username})
              </div>

              {/* BOOSTERS */}
              <div className="flex gap-1 mt-1 flex-wrap">
                {p.boosters?.includes("mg") && (
                  <Badge color="purple">MG</Badge>
                )}
                {p.boosters?.includes("bomb") && (
                  <Badge color="red">BOMB</Badge>
                )}
              </div>

              {/* SCORE */}
              <div className="text-xs text-slate-400 mt-1">
                Score: {fmt(p.score)} 💎
              </div>

              {/* ELIM ACTION */}
              {p.positionStatus === "elimination" && (
                <Button
                  variant="danger"
                  className="mt-2 w-full text-xs"
                  onClick={() => {
                    const formatted = p.username.startsWith("@")
                      ? p.username
                      : `@${p.username}`;

                    openConfirm({
                      message: `Speler ${formatted} staat op elimination. Permanent verwijderen?`,
                      username: formatted,
                      action: "removeFromArenaPermanent",
                    });
                  }}
                >
                  Verwijder speler
                </Button>
              )}
            </div>
          ))
        ) : (
          Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="bg-[#13161C] text-slate-500 p-3 rounded-[4px] text-center border border-[#2A3038]"
            >
              #{i + 1} – WACHT OP SPELER
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
