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
} from "@/lib/adminTypes";

export type InitialSnapshot = {
  arena: ArenaState;
  queue: { open: boolean; entries: QueueEntry[] };
  logs: LogEntry[];
  settings: any;
  gameSession: {
    active: boolean;
    gameId: number | null;
  };
  stats: any;
  playerLeaderboard: PlayerLeaderboardEntry[];
  gifterLeaderboard: GifterLeaderboardEntry[];
};

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
  // SOCKET SETUP
  // --------------------------------------------------------------------
  useEffect(() => {
    const socket = getAdminSocket();
    let mounted = true;

    socket.on("updateArena", (data: ArenaState) => {
      if (mounted) setArena(data);
    });

    socket.on("updateQueue", (data) => {
      if (!mounted) return;
      setQueue(data.entries ?? []);
      setQueueOpen(data.open ?? true);
    });

    socket.on("log", (log: LogEntry) => {
      if (!mounted) return;
      setLogs((prev) => [log, ...prev].slice(0, 300));
    });

    socket.on("leaderboardPlayers", (rows: PlayerLeaderboardEntry[]) => {
      if (mounted) setPlayerLb(rows);
    });

    socket.on("leaderboardGifters", (rows: GifterLeaderboardEntry[]) => {
      if (mounted) setGifterLb(rows);
    });

    socket.on("connect_error", () => {
      if (mounted) setError("Geen verbinding met backend (socket.io)");
    });

    // INITIAL SNAPSHOT
    socket.emit("admin:getInitialSnapshot", {}, (snap: InitialSnapshot) => {
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
  // FINAL FIX — UNIVERSAL ADMIN EMITTER
  // Always expects payload as an object { ... }
  // --------------------------------------------------------------------
  async function emitAdminAction(
    event: string,
    payload: Record<string, any> = {}
  ): Promise<void> {
    return new Promise((resolve) => {
      const socket = getAdminSocket();

      (socket.emit as any)(
        event,
        payload,
        (res: AdminAckResponse) => {
          if (!res) {
            console.warn(`[ADMIN] No ACK for`, event, payload);
            return resolve();
          }

          if (!res.success) {
            console.warn(`[ADMIN] FAIL`, event, res.message);
          }

          resolve();
        }
      );
    });
  }

  // --------------------------------------------------------------------
  // RETURN API
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

    // ----------------------------------------------------------------
    // ADMIN ACTIONS — ALL TS-SAFE, ALL PAYLOAD FIXED
    // ----------------------------------------------------------------
    addToArena: (u: string) =>
      emitAdminAction("admin:addToArena", { username: normalizeUsername(u) }),

    addToQueue: (u: string) =>
      emitAdminAction("admin:addToQueue", { username: normalizeUsername(u) }),

    eliminate: (u: string) =>
      emitAdminAction("admin:eliminate", { username: normalizeUsername(u) }),

    promoteQueue: (u: string) =>
      emitAdminAction("admin:promoteUser", { username: normalizeUsername(u) }),

    demoteQueue: (u: string) =>
      emitAdminAction("admin:demoteUser", { username: normalizeUsername(u) }),

    removeFromQueue: (u: string) =>
      emitAdminAction("admin:removeFromQueue", { username: normalizeUsername(u) }),
  };
}
