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
  // 1. GLOBAL REALTIME STATE
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
    emitAdmin,        // ⬅️ typesafe emit
    emitAdminWithUser // ⬅️ typesafe emit user
  } = useAdminSocket();

  // ======================================================
  // 2. Confirm dialog
  // ======================================================
  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const openConfirm = (msg: string, onConfirm: () => void) => {
    setConfirm({ message: msg, onConfirm });
  };

  const closeConfirm = () => setConfirm(null);

  // ======================================================
  // 3. AUTOCOMPLETE + connected fields
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
  // 4. UI
  // ======================================================
  return (
    <main className="min-h-screen bg-[#0D0F12] text-white p-6">

      {/* PAGE HEADER */}
      <header className="max-w-[1600px] mx-auto mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="text-3xl font-bold text-[#f97316]">UB</div>
            <div>
              <h1 className="text-2xl font-bold">Undercover BattleBox – Admin</h1>
              <p className="text-sm text-slate-400">
                Verbonden als{" "}
                <span className="text-green-400 font-semibold">Admin</span>
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

      {/* MAIN GRID */}
      <div className="max-w-[1600px] mx-auto grid gap-6">

        {/* ---------- CONTROLS PANEL ---------- */}
        <ControlsPanel
          gameSession={gameSession}
          arena={arena}
          emitAdmin={emitAdmin}        // ✔ correct
        />

        {/* ---------- PLAYER ACTIONS PANEL ---------- */}
        <PlayerActionsPanel
          username={username}
          setUsername={setUsername}
          emitAdmin={emitAdmin}
          emitAdminUser={emitAdminUser}
          autocomplete={autocomplete}
        />

        {/* ---------- ARENA PANEL ---------- */}
        <ArenaPanel
          arena={arena}
          players={arena?.players ?? []}
          fmt={fmt}
          emitAdmin={emitAdmin}
          openConfirm={openConfirm}
        />

        {/* ---------- QUEUE PANEL ---------- */}
        <QueuePanel
          queue={queue}
          queueOpen={queueOpen}
          emitAdmin={emitAdmin}
          fmt={fmt}
        />

        {/* ---------- LEADERBOARD PANEL ---------- */}
        <LeaderboardPanel
          playerLeaderboard={playerLeaderboard}
          gifterLeaderboard={gifterLeaderboard}
          fmt={fmt}
        />

        {/* ---------- TWISTS PANEL ---------- */}
        <TwistsPanel
          twistUserGive={twistUserGive}
          setTwistUserGive={setTwistUserGive}
          twistUserUse={twistUserUse}
          setTwistUserUse={setTwistUserUse}
          twistTarget={twistTarget}
          setTwistTarget={setTwistTarget}
          emitAdmin={emitAdmin}
          autocomplete={autocomplete}
        />

        {/* ---------- LOGS PANEL ---------- */}
        <LogsPanel logs={logs} />
      </div>

      {/* FOOTER */}
      <footer className="max-w-[1600px] mx-auto mt-10 text-xs text-slate-600 text-center py-6">
        BattleBox Admin v3.0 • Dark Mode • Reworked UI/UX
      </footer>

      {/* CONFIRM */}
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
