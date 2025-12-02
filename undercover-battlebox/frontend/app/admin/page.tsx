"use client";

import React, { useState } from "react";

// Core hooks
import { useAdminSocket } from "@/hooks/useAdminSocket";
import { useAutocomplete } from "@/hooks/useAutocomplete";

// Emit utilities
import { emitAdmin, emitAdminUser } from "@/lib/adminEmit";

// UI Components
import ConfirmDialog from "@/components/admin/ui/ConfirmDialog";

// Panels
import ControlsPanel from "@/components/admin/panels/ControlsPanel";
import PlayerActionsPanel from "@/components/admin/panels/PlayerActionsPanel";
import ArenaPanel from "@/components/admin/panels/ArenaPanel";
import QueuePanel from "@/components/admin/panels/QueuePanel";
import LeaderboardPanel from "@/components/admin/panels/LeaderboardPanel";
import TwistsPanel from "@/components/admin/panels/TwistsPanel";
import LogsPanel from "@/components/admin/panels/LogsPanel";

export default function AdminDashboardPage() {
  // ======================================================
  // SOCKET STATE
  // ======================================================
  const {
    arena,
    queue,
    queueOpen,
    logs,
    playerLeaderboard,
    gifterLeaderboard,
    gameSession,
    hostDiamonds,
    status,
    fmt,
  } = useAdminSocket();

  // ======================================================
  // CONFIRMDIALOG STATE
  // ======================================================
  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Wrapper die OOK ArenaPanel calls accepteert
  const openConfirm = (arg1: any, arg2?: any) => {
    // Case 1: Panels zoals Controls / Players gebruiken: openConfirm("msg", fn)
    if (typeof arg1 === "string" && typeof arg2 === "function") {
      return setConfirm({
        message: arg1,
        onConfirm: arg2,
      });
    }

    // Case 2: ArenaPanel gebruikt object { message, username, action }
    if (arg1 && typeof arg1 === "object") {
      const { message, username, action } = arg1;

      return setConfirm({
        message,
        onConfirm: () => {
          emitAdmin(action, { username });
        },
      });
    }

    console.warn("openConfirm() kreeg een onbekend format:", arg1, arg2);
  };

  const closeConfirm = () => setConfirm(null);

  // ======================================================
  // AUTOCOMPLETE
  // ======================================================
  const [username, setUsername] = useState("");
  const [twistUserGive, setTwistUserGive] = useState("");
  const [twistUserUse, setTwistUserUse] = useState("");
  const [twistTarget, setTwistTarget] = useState("");

  const autocomplete = useAutocomplete((field, value) => {
    if (field === "main") setUsername(value);
    if (field === "give") setTwistUserGive(value);
    if (field === "use") setTwistUserUse(value);
    if (field === "target") setTwistTarget(value);
  });

  // ======================================================
  // PAGE UI
  // ======================================================
  return (
    <main className="min-h-screen bg-[#0D0F12] text-white p-6">
      {/* HEADER */}
      <header className="max-w-[1600px] mx-auto mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="text-3xl font-bold text-[#f97316]">UB</div>
            <div>
              <h1 className="text-2xl font-bold">Undercover BattleBox – Admin</h1>
              <p className="text-sm text-slate-400">
                Verbonden als <span className="text-green-400 font-semibold">Admin</span>
              </p>
            </div>
          </div>

          <div className="px-3 py-1.5 rounded-md bg-slate-800 text-xs border border-slate-700 shadow">
            {gameSession.active
              ? `Spel actief (#${gameSession.gameId})`
              : "Geen spel actief"}
          </div>
        </div>

        {status && <div className="mt-3 text-sm text-slate-300">{status}</div>}
      </header>

      {/* GRID */}
      <div className="max-w-[1600px] mx-auto grid gap-6">

        {/* CONTROLS */}
        <ControlsPanel
          gameSession={gameSession}
          arena={arena}
          emitAdmin={emitAdmin}
        />

        {/* PLAYER ACTIONS */}
        <PlayerActionsPanel
          username={username}
          setUsername={setUsername}
          emitAdmin={emitAdmin}
          emitAdminUser={emitAdminUser}
          autocomplete={autocomplete}
        />

        {/* ARENA */}
        <ArenaPanel
          arena={arena}
          players={arena?.players ?? []}
          fmt={fmt}
          hostDiamonds={hostDiamonds}
          emitAdmin={emitAdmin}
          openConfirm={openConfirm}
        />

        {/* QUEUE */}
        <QueuePanel
          queue={queue}
          queueOpen={queueOpen}
          emitAdmin={emitAdmin}
          fmt={fmt}
        />

        {/* LEADERBOARD */}
        <LeaderboardPanel
          playerLeaderboard={playerLeaderboard}
          gifterLeaderboard={gifterLeaderboard}
          fmt={fmt}
        />

        {/* TWISTS */}
        <TwistsPanel
          twistUserGive={twistUserGive}
          setTwistUserGive={setTwistUserGive}
          twistUserUse={twistUserUse}
          setTwistUserUse={setTwistUserUse}
          twistTargetUse={twistTarget}
          setTwistTargetUse={setTwistTarget}
          emitAdmin={emitAdmin}
          autocomplete={autocomplete}
        />

        {/* LOGS */}
        <LogsPanel logs={logs} />
      </div>

      {/* FOOTER */}
      <footer className="max-w-[1600px] mx-auto mt-10 text-xs text-slate-600 text-center py-6">
        BattleBox Admin v3.0 • Dark Mode • Reworked UI/UX
      </footer>

      {/* CONFIRM MODAL */}
      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message ?? ""}
        onCancel={closeConfirm}
        onConfirm={() => {
          confirm?.onConfirm();
          closeConfirm();
        }}
      />
    </main>
  );
}
