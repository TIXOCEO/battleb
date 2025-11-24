"use client";

import { useEffect, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  AdminAckResponse,
  PlayerLeaderboardEntry,
  GifterLeaderboardEntry,
  InitialSnapshot,
} from "@/lib/adminTypes";

export function useAdminGame() {
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastActionStatus, setLastActionStatus] = useState<string | null>(null);

  const [playerLb, setPlayerLb] = useState<PlayerLeaderboardEntry[]>([]);
  const [gifterLb, setGifterLb] = useState<GifterLeaderboardEntry[]>([]);
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);

  // --------------------------------------------------------------------
  // SOCKET SETUP — FIXED PREFIX-LESS
  // --------------------------------------------------------------------
  useEffect(() => {
    const socket = getAdminSocket();
    let mounted = true;

    socket.on("updateArena", (data: ArenaState) => mounted && setArena(data));

    socket.on("updateQueue", (data) => {
      if (!mounted) return;
      setQueue(data.entries ?? []);
      setQueueOpen(data.open ?? true);
    });

    socket.on("log", (log: LogEntry) => {
      if (!mounted) return;
      setLogs((prev) => [log, ...prev].slice(0, 300));
    });

    socket.on("leaderboardPlayers", (rows) => mounted && setPlayerLb(rows));
    socket.on("leaderboardGifters", (rows) => mounted && setGifterLb(rows));

    socket.on("connect_error", () => {
      if (mounted) setError("Geen verbinding met backend (socket.io)");
    });

    // ----------------------------------------------------------------
    // INITIAL SNAPSHOT — FIXED (NO PREFIX)
    // ----------------------------------------------------------------
    socket.emit("getInitialSnapshot", {}, (snap: InitialSnapshot) => {
      if (!mounted || snapshotLoaded) return;

      setArena(snap.arena);
      setQueue(snap.queue.entries);
      setQueueOpen(snap.queue.open);
      setLogs(snap.logs);
      setPlayerLb(snap.playerLeaderboard);
      setGifterLb(snap.gifterLeaderboard);

      setSnapshotLoaded(true);
      setLoading(false);
    });

    return () => {
      mounted = false;
      socket.off("updateArena");
      socket.off("updateQueue");
      socket.off("log");
      socket.off("leaderboardPlayers");
      socket.off("leaderboardGifters");
      socket.off("connect_error");
    };
  }, [snapshotLoaded]);

  // --------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------
  function normalizeUsername(v: string): string {
    if (!v) return "";
    const trimmed = v.trim().replace(/^@+/, "");
    return `@${trimmed}`;
  }

  // --------------------------------------------------------------------
  // GENERIC EMITTER — NO PREFIX
  // --------------------------------------------------------------------
  async function emitAdminAction(
    event: keyof import("@/lib/adminTypes").AdminSocketOutbound,
    payload: Record<string, any> = {}
  ) {
    return new Promise<void>((resolve) => {
      const socket = getAdminSocket();

      socket.emit(event, payload, (res: AdminAckResponse) => {
        if (!res) return resolve();
        if (!res.success) console.warn(`[ADMIN] FAIL`, event, res.message);
        resolve();
      });
    });
  }

  // --------------------------------------------------------------------
  // RETURN API — ALL FIXED (NO PREFIX)
  // --------------------------------------------------------------------
  return {
    arena,
    queue,
    queueOpen,
    logs,
    loading,
    error,
    lastActionStatus,
    playerLb,
    gifterLb,

    clearStatus: () => setLastActionStatus(null),

    addToArena: (u: string) =>
      emitAdminAction("addToArena", { username: normalizeUsername(u) }),

    addToQueue: (u: string) =>
      emitAdminAction("addToQueue", { username: normalizeUsername(u) }),

    eliminate: (u: string) =>
      emitAdminAction("eliminate", { username: normalizeUsername(u) }),

    promoteQueue: (u: string) =>
      emitAdminAction("promoteUser", { username: normalizeUsername(u) }),

    demoteQueue: (u: string) =>
      emitAdminAction("demoteUser", { username: normalizeUsername(u) }),

    removeFromQueue: (u: string) =>
      emitAdminAction("removeFromQueue", { username: normalizeUsername(u) }),
  };
}
