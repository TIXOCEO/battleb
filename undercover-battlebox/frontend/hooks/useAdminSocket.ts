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
} from "@/lib/adminTypes";

/**
 * De centrale socket-hook voor het hele Admin Dashboard.
 * Houdt ALLE realtime data bij op een nette, modulaire, schaalbare manier.
 *
 * Panels ontvangen state via props vanuit page.tsx.
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
  // INITIAL SNAPSHOT LOADING
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
  // SOCKET LISTENERS REGISTEREN
  // ===============================
  useEffect(() => {
    const socket = getAdminSocket();

    socket.on("updateArena", (data: ArenaState) => {
      setArena(data);
    });

    socket.on("updateQueue", (d: any) => {
      setQueue(d.entries ?? []);
      setQueueOpen(d.open ?? true);
    });

    // logs
    socket.on("log", (l: LogEntry) =>
      setLogs((prev) => [l, ...prev].slice(0, 200))
    );
    socket.on("initialLogs", (rows: LogEntry[]) =>
      setLogs(rows.slice(0, 200))
    );

    // leaderboard
    socket.on("leaderboardPlayers", (rows: PlayerLeaderboardEntry[]) =>
      setPlayerLeaderboard(rows)
    );
    socket.on("leaderboardGifters", (rows: GifterLeaderboardEntry[]) =>
      setGifterLeaderboard(rows)
    );

    // host diamonds
    socket.on("hostDiamonds", (d) => setHostDiamonds(d.total ?? 0));

    // game session
    socket.on("gameSession", (s: GameSessionState) => {
      setGameSession(s);
    });

    // round events (UI feedback)
    socket.on("round:start", (d) =>
      setStatus(`▶️ Ronde gestart (${d.type}) – ${d.duration}s`)
    );
    socket.on("round:grace", (d) =>
      setStatus(`⏳ Grace periode (${d.grace}s)`)
    );
    socket.on("round:end", () =>
      setStatus("⛔ Ronde beëindigd – eliminatiefase")
    );

    // disconnect
    socket.on("connect_error", () =>
      setStatus("❌ Verbinding verloren met server")
    );
    socket.on("disconnect", () =>
      setStatus("❌ Verbinding verbroken")
    );
    socket.on("connect", () =>
      setStatus("🔌 Verbonden met server")
    );

    // Cleanup
    return () => {
      socket.removeAllListeners();
    };
  }, []);

  // ===============================
  // RONDE TIMER UPDATES
  // ===============================
  useEffect(() => {
    const t = setInterval(() => {
      setArena((a) => (a ? { ...a } : a));
    }, 1000);

    return () => clearInterval(t);
  }, []);

  // ===============================
  // HELPER: ADMIN EVENTS (met ACK response)
  // ===============================
  function emitAdmin(event: string, payload?: any) {
    const socket = getAdminSocket();

    setStatus(`Bezig met ${event}...`);

    socket.emit(event, payload ?? {}, (res: AdminAckResponse) => {
      if (res?.success) setStatus("✅ Uitgevoerd");
      else setStatus(`❌ ${res?.message ?? "Onbekende fout"}`);
    });
  }

  function emitAdminWithUser(event: string, username: string) {
    if (!username) return;

    const socket = getAdminSocket();
    const formatted = username.startsWith("@") ? username : `@${username}`;

    setStatus(`Bezig met ${event}...`);

    socket.emit(event, { username: formatted }, (res: AdminAckResponse) => {
      if (res?.success) setStatus("✅ Uitgevoerd");
      else setStatus(`❌ ${res?.message ?? "Onbekende fout"}`);
    });
  }

  // ===============================
  // EXPOSED API
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
