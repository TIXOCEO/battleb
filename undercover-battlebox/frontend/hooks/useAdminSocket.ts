"use client";

import { useEffect, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";

import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  PlayerLeaderboardEntry,
  GifterLeaderboardEntry,
  AdminAckResponse,
  GameSessionState,
  AdminSocketOutbound,
} from "@/lib/adminTypes";

/**
 * De centrale socket-hook voor het hele Admin Dashboard.
 * Houdt ALLE realtime data bij.
 */
export function useAdminSocket() {
  // ===============================
  // STATE
  // ===============================
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [playerLeaderboard, setPlayerLeaderboard] = useState<
    PlayerLeaderboardEntry[]
  >([]);
  const [gifterLeaderboard, setGifterLeaderboard] = useState<
    GifterLeaderboardEntry[]
  >([]);

  const [gameSession, setGameSession] = useState<GameSessionState>({
    active: false,
    gameId: null,
  });

  const [hostDiamonds, setHostDiamonds] = useState(0);

  const [status, setStatus] = useState<string | null>(null);

  // ===============================
  // INITIAL SNAPSHOT
  // ===============================
  useEffect(() => {
    const socket = getAdminSocket();

    socket.emit("getInitialSnapshot", {}, (snap: any) => {
      if (!snap) return;

      if (snap.arena) setArena(snap.arena);
      if (snap.queue) {
        setQueue(snap.queue.entries ?? []);
        setQueueOpen(snap.queue.open ?? true);
      }
      if (snap.logs) setLogs(snap.logs.slice(0, 200));

      if (snap.playerLeaderboard) setPlayerLeaderboard(snap.playerLeaderboard);
      if (snap.gifterLeaderboard) setGifterLeaderboard(snap.gifterLeaderboard);

      if (snap.gameSession) setGameSession(snap.gameSession);
      if (snap.hostDiamonds) setHostDiamonds(snap.hostDiamonds.total ?? 0);
    });
  }, []);

  // ===============================
  // SOCKET LISTENERS
  // ===============================
  useEffect(() => {
    const socket = getAdminSocket();

    socket.on("updateArena", (data: ArenaState) => setArena(data));

    socket.on("updateQueue", (d: any) => {
      setQueue(d.entries ?? []);
      setQueueOpen(d.open ?? true);
    });

    socket.on("log", (l: LogEntry) =>
      setLogs((prev) => [l, ...prev].slice(0, 200))
    );
    socket.on("initialLogs", (rows: LogEntry[]) =>
      setLogs(rows.slice(0, 200))
    );

    socket.on("leaderboardPlayers", (rows: PlayerLeaderboardEntry[]) =>
      setPlayerLeaderboard(rows)
    );
    socket.on("leaderboardGifters", (rows: GifterLeaderboardEntry[]) =>
      setGifterLeaderboard(rows)
    );

    socket.on("hostDiamonds", (d) => setHostDiamonds(d.total ?? 0));

    socket.on("gameSession", (s: GameSessionState) => setGameSession(s));

    socket.on("round:start", (d) =>
      setStatus(`▶️ Ronde gestart (${d.type}) – ${d.duration}s`)
    );
    socket.on("round:grace", (d) =>
      setStatus(`⏳ Grace periode (${d.grace}s)`)
    );
    socket.on("round:end", () =>
      setStatus("⛔ Ronde beëindigd – eliminatiefase")
    );

    socket.on("connect_error", () =>
      setStatus("❌ Verbinding verloren met server")
    );
    socket.on("disconnect", () =>
      setStatus("❌ Verbinding verbroken")
    );
    socket.on("connect", () =>
      setStatus("🔌 Verbonden met server")
    );

    return () => {
      socket.removeAllListeners();
    };
  }, []);

  // ===============================
  // RONDE TIMER
  // ===============================
  useEffect(() => {
    const t = setInterval(() => {
      setArena((a) => (a ? { ...a } : a));
    }, 1000);

    return () => clearInterval(t);
  }, []);

  // ===============================
  // TYPESAFE EMIT
  // ===============================
  function emitAdmin<E extends keyof AdminSocketOutbound>(
    event: E,
    payload: Parameters<AdminSocketOutbound[E]>[0]
  ) {
    const socket = getAdminSocket();

    setStatus(`Bezig met ${event}...`);

    socket.emit(
      event,
      payload,
      (res: AdminAckResponse) => {
        if (res?.success) setStatus("✅ Uitgevoerd");
        else setStatus(`❌ ${res?.message ?? "Onbekende fout"}`);
      }
    );
  }

  function emitAdminWithUser<E extends keyof AdminSocketOutbound>(
    event: E,
    username: string
  ) {
    if (!username) return;

    const socket = getAdminSocket();
    const formatted = username.startsWith("@") ? username : `@${username}`;

    setStatus(`Bezig met ${event}...`);

    socket.emit(
      event,
      { username: formatted } as Parameters<AdminSocketOutbound[E]>[0],
      (res: AdminAckResponse) => {
        if (res?.success) setStatus("✅ Uitgevoerd");
        else setStatus(`❌ ${res?.message ?? "Onbekende fout"}`);
      }
    );
  }

  // ===============================
  // API RETURN
  // ===============================
  return {
    // state
    arena,
    queue,
    queueOpen,
    logs,
    playerLeaderboard,
    gifterLeaderboard,
    gameSession,
    hostDiamonds,
    status,

    // actions
    emitAdmin,
    emitAdminWithUser,

    // helpers
    fmt: (v: any) => Number(v ?? 0).toLocaleString("nl-NL"),
  };
}
