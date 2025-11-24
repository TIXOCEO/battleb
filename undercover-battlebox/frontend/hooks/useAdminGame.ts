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
import type { AdminSocketOutbound } from "@/lib/socketClient";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN ?? "";

// REST API wrapper (zeldzaam gebruikt)
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

export function useAdminGame() {
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState<boolean>(true);

  const [logs, setLogs] = useState<LogEntry[]>([]);

  // ★ Leaderboards toegevoegd
  const [playerLB, setPlayerLB] = useState<PlayerLeaderboardEntry[]>([]);
  const [gifterLB, setGifterLB] = useState<GifterLeaderboardEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lastActionStatus, setLastActionStatus] = useState<string | null>(null);

  // ========================================================================
  // INIT SOCKET + LISTENERS
  // ========================================================================
  useEffect(() => {
    let mounted = true;
    const socket = getAdminSocket();

    // -----------------------------
    // ARENA
    // -----------------------------
    socket.on("updateArena", (data: ArenaState) => {
      if (!mounted) return;
      setArena(data);
    });

    // -----------------------------
    // QUEUE
    // -----------------------------
    socket.on("updateQueue", (data: { open: boolean; entries: QueueEntry[] }) => {
      if (!mounted) return;
      setQueue(data.entries ?? []);
      setQueueOpen(data.open ?? true);
    });

    // -----------------------------
    // LOGS
    // -----------------------------
    socket.on("log", (l) => {
      if (!mounted) return;
      setLogs((prev) => [l, ...prev].slice(0, 200));
    });

    socket.on("initialLogs", (rows: LogEntry[]) => {
      if (!mounted) return;
      setLogs(rows.slice(0, 200));
    });

    // -----------------------------
    // LEADERBOARDS  ★ toegevoegd
    // -----------------------------
    socket.on("leaderboardPlayers", (rows: PlayerLeaderboardEntry[]) => {
      if (!mounted) return;
      setPlayerLB(rows);
    });

    socket.on("leaderboardGifters", (rows: GifterLeaderboardEntry[]) => {
      if (!mounted) return;
      setGifterLB(rows);
    });

    // -----------------------------
    // SNAPSHOT (★ nieuw)
    // -----------------------------
    socket.on("snapshot", (snap: InitialSnapshot) => {
      if (!mounted) return;

      if (snap.arena) setArena(snap.arena);
      if (snap.queue) {
        setQueue(snap.queue.entries ?? []);
        setQueueOpen(snap.queue.open ?? true);
      }
      if (snap.logs) setLogs(snap.logs.slice(0, 200));
      if (snap.playerLeaderboard) setPlayerLB(snap.playerLeaderboard);
      if (snap.gifterLeaderboard) setGifterLB(snap.gifterLeaderboard);

      setLoading(false);
    });

    // -----------------------------
    // ERROR HANDLING
    // -----------------------------
    socket.on("connect_error", (err) => {
      if (!mounted) return;
      console.error("Socket connect error:", err);
      setError("Geen live verbinding met backend (Socket.io)");
    });

    setLoading(false);

    // Cleanup
    return () => {
      mounted = false;
      socket.off("updateArena");
      socket.off("updateQueue");
      socket.off("log");
      socket.off("initialLogs");
      socket.off("leaderboardPlayers");
      socket.off("leaderboardGifters");
      socket.off("snapshot");
      socket.off("connect_error");
    };
  }, []);

  // ========================================================================
  // ADMIN ACTION WRAPPER
  // ========================================================================
  function normalizeUsername(username: string): string {
    const trimmed = username.trim();
    if (!trimmed) return trimmed;
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  }

  async function emitAdminAction(event: string, username: string): Promise<void> {
    return new Promise((resolve) => {
      const socket = getAdminSocket();
      const normalized = normalizeUsername(username);

      setLastActionStatus(`Bezig: ${event} → ${normalized}...`);

      socket.emit(
        event as keyof AdminSocketOutbound, // TS fix
        { username: normalized },
        (res: AdminAckResponse) => {
          if (!res) {
            setLastActionStatus(`Geen antwoord van server op ${event} (${normalized})`);
            return resolve();
          }

          if (!res.success) {
            setLastActionStatus(
              `Fout: ${res.message ?? "onbekende fout"} (${normalized})`
            );
          } else {
            setLastActionStatus(
              `OK: ${res.message ?? "Actie uitgevoerd"} (${normalized})`
            );
          }

          resolve();
        }
      );
    });
  }

  // ========================================================================
  // RETURN
  // ========================================================================
  return {
    // STATE
    arena,
    queue,
    queueOpen,
    logs,
    loading,
    error,
    lastActionStatus,

    // ★ Leaderboards
    playerLB,
    gifterLB,

    // ACTIONS
    addToArena: (u: string) => emitAdminAction("admin:addToArena", u),
    addToQueue: (u: string) => emitAdminAction("admin:addToQueue", u),
    eliminate: (u: string) => emitAdminAction("admin:eliminate", u),

    promoteQueue: (u: string) => emitAdminAction("admin:promoteUser", u),
    demoteQueue: (u: string) => emitAdminAction("admin:demoteUser", u),
    removeFromQueue: (u: string) => emitAdminAction("admin:removeFromQueue", u),

    clearStatus: () => setLastActionStatus(null),
  };
}
