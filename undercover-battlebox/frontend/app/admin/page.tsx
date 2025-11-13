// app/admin/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  AdminAckResponse,
} from "@/lib/adminTypes";

type StreamStats = {
  totalPlayers: number;
  totalPlayerDiamonds: number;
  totalHostDiamonds: number;
};

type LeaderboardEntry = {
  user_id: string;
  display_name: string;
  username: string;
  total_diamonds: number;
};

type GameSessionState = {
  active: boolean;
  gameId: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
};

export default function AdminDashboardPage() {
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [username, setUsername] = useState("");

  const [status, setStatus] = useState<string | null>(null);

  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [gameSession, setGameSession] = useState<GameSessionState>({
    active: false,
    gameId: null,
  });

  // ───────────────────────────────────────────────
  // SOCKET LISTENERS (blijven hangen, snapshot apart)
  // ───────────────────────────────────────────────
  useEffect(() => {
    const socket = getAdminSocket();

    const handleArena = (data: ArenaState) => setArena(data);

    const handleQueue = (d: any) => {
      setQueue(d.entries ?? []);
      setQueueOpen(d.open ?? true);
    };

    const handleLog = (l: LogEntry) =>
      setLogs((prev) => [l, ...prev].slice(0, 200));

    const handleInitialLogs = (d: LogEntry[]) =>
      setLogs(d.slice(0, 200));

    const handleStats = (s: StreamStats) => setStreamStats(s);

    const handleLeaderboard = (entries: LeaderboardEntry[]) =>
      setLeaderboard(entries);

    const handleGameSession = (session: GameSessionState) =>
      setGameSession(session);

    const handleConnectError = (err: any) => {
      console.error("❌ Socket connectiefout:", err?.message);
      setStatus("❌ Socket verbinding weggevallen");
    };

    const handleRoundStart = (d: any) =>
      setStatus(`▶️ Ronde gestart (${d.type}) — ${d.duration}s`);

    const handleRoundGrace = (d: any) =>
      setStatus(`⏳ Grace-periode actief (${d.grace}s)`);

    const handleRoundEnd = () => setStatus("⛔ Ronde beëindigd");

    // Registreren
    socket.on("updateArena", handleArena);
    socket.on("updateQueue", handleQueue);
    socket.on("log", handleLog);
    socket.on("initialLogs", handleInitialLogs);
    socket.on("streamStats", handleStats);
    socket.on("streamLeaderboard", handleLeaderboard);
    socket.on("gameSession", handleGameSession);
    socket.on("connect_error", handleConnectError);
    socket.on("round:start", handleRoundStart);
    socket.on("round:grace", handleRoundGrace);
    socket.on("round:end", handleRoundEnd);

    // Cleanup: alleen eigen handlers weghalen
    return () => {
      socket.off("updateArena", handleArena);
      socket.off("updateQueue", handleQueue);
      socket.off("log", handleLog);
      socket.off("initialLogs", handleInitialLogs);
      socket.off("streamStats", handleStats);
      socket.off("streamLeaderboard", handleLeaderboard);
      socket.off("gameSession", handleGameSession);
      socket.off("connect_error", handleConnectError);
      socket.off("round:start", handleRoundStart);
      socket.off("round:grace", handleRoundGrace);
      socket.off("round:end", handleRoundEnd);
    };
  }, []);

  // 🔄 Snapshot binnenhalen bij binnenkomen op dashboard
  useEffect(() => {
    const socket = getAdminSocket();

    socket.emit("admin:getInitialSnapshot", {}, (snap: any) => {
      if (!snap) return;

      if (snap.arena) setArena(snap.arena);
      if (snap.queue) {
        setQueue(snap.queue.entries ?? []);
        setQueueOpen(snap.queue.open ?? true);
      }
      if (snap.logs) setLogs(snap.logs.slice(0, 200));
      if (snap.stats) setStreamStats(snap.stats);
      if (snap.gameSession) setGameSession(snap.gameSession);
      if (snap.leaderboard) setLeaderboard(snap.leaderboard);
    });
  }, []);

  // ───────────────────────────────────────────────
  // EMITTER HELPERS
  // ───────────────────────────────────────────────
  const emitAdmin = (event: string, payload?: any) => {
    const socket = getAdminSocket();
    setStatus(`Bezig met ${event}...`);
    socket.emit(event, payload || {}, (res: AdminAckResponse) =>
      setStatus(res.success ? "✅ Uitgevoerd" : `❌ ${res.message}`)
    );
  };

  const emitAdminWithUser = (event: string, target?: string) => {
    const socket = getAdminSocket();
    const uname = target || username;
    if (!uname.trim()) return;

    const u = uname.startsWith("@") ? uname : `@${uname}`;

    setStatus(`Bezig met ${event}...`);
    socket.emit(event, { username: u }, (res: AdminAckResponse) =>
      setStatus(res.success ? "✅ Uitgevoerd" : `❌ ${res.message}`)
    );
  };

  const fmt = (n: number) =>
    n.toLocaleString("nl-NL", { maximumFractionDigits: 0 });

  const sortedPlayers = useMemo(() => arena?.players ?? [], [arena]);

  // ───────────────────────────────────────────────
  // RENDER
  // ───────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-6">
        <div className="flex items-center gap-2">
          <div className="text-2xl font-bold text-[#ff4d4f]">UB</div>
          <div>
            <div className="text-xl font-semibold">Undercover BattleBox – Admin</div>
            <div className="text-xs text-gray-500">
              Verbonden als{" "}
              <span className="font-semibold text-green-600">Admin</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span
            className={`px-3 py-1 rounded-full ${
              gameSession.active
                ? "bg-green-100 text-green-700"
                : "bg-gray-200 text-gray-800"
            }`}
          >
            {gameSession.active
              ? `Spel actief (#${gameSession.gameId})`
              : "Geen spel actief"}
          </span>
        </div>
      </header>

      {/* SPEL & RONDEBESTURING */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Spelbesturing */}
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold">Spelbesturing</div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => emitAdmin("admin:startGame")}
              className="px-3 py-1.5 bg-green-600 text-white rounded-full text-xs"
            >
              Start spel
            </button>
            <button
              onClick={() => emitAdmin("admin:stopGame")}
              className="px-3 py-1.5 bg-yellow-500 text-white rounded-full text-xs"
            >
              Stop spel
            </button>
          </div>

          {/* Rondebesturing */}
          <div>
            <div className="text-xs text-gray-600 mb-1">Ronde type</div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() =>
                  emitAdmin("admin:startRound", { type: "quarter" })
                }
                className="px-3 py-1.5 bg-[#ff4d4f] text-white rounded-full text-xs"
              >
                Start voorronde
              </button>

              <button
                onClick={() =>
                  emitAdmin("admin:startRound", { type: "finale" })
                }
                className="px-3 py-1.5 bg-gray-900 text-white rounded-full text-xs"
              >
                Start finale
              </button>

              <button
                onClick={() => emitAdmin("admin:endRound")}
                className="px-3 py-1.5 bg-red-600 text-white rounded-full text-xs"
              >
                Stop ronde
              </button>
            </div>
          </div>

          {/* Status ronde */}
          <div className="mt-3 text-sm">
            <div className="text-gray-600">Ronde status:</div>

            <div
              className={`inline-block mt-1 px-2 py-1 rounded-full text-xs ${
                arena?.status === "active"
                  ? "bg-green-100 text-green-700"
                  : arena?.status === "grace"
                  ? "bg-amber-100 text-amber-700"
                  : arena?.status === "ended"
                  ? "bg-red-100 text-red-700"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {arena?.status ?? "idle"}
            </div>

            <div className="mt-2 text-gray-700">
              Tijd:{" "}
              <span className="font-mono">
                {arena?.timeLeft
                  ? `${Math.floor(arena.timeLeft / 60)
                      .toString()
                      .padStart(2, "0")}:${(arena.timeLeft % 60)
                      .toString()
                      .padStart(2, "0")}`
                  : "00:00"}
              </span>
            </div>

            {arena?.status === "grace" && (
              <div className="text-xs text-amber-600 mt-1">
                Gifts tellen nog mee…
              </div>
            )}
          </div>
        </div>

        {/* USER ACTIES */}
        <div className="lg:col-span-2 flex flex-col gap-3">
          <div className="text-sm font-semibold">Speleracties</div>

          <div className="flex flex-col md:flex-row gap-3 md:items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-600 font-semibold mb-1 block">
                @username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@gebruikersnaam"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div className="flex gap-2 text-xs">
              <button
                onClick={() => emitAdminWithUser("admin:addToArena")}
                className="px-3 py-1.5 bg-[#ff4d4f] text-white rounded-full"
              >
                → Arena
              </button>

              <button
                onClick={() => emitAdminWithUser("admin:addToQueue")}
                className="px-3 py-1.5 bg-gray-800 text-white rounded-full"
              >
                → Queue
              </button>

              <button
                onClick={() => emitAdminWithUser("admin:eliminate")}
                className="px-3 py-1.5 bg-red-600 text-white rounded-full"
              >
                Elimineer
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* STATUS MELDING */}
      {status && (
        <div className="mb-4 text-sm text-center bg-amber-50 border border-amber-200 text-amber-800 rounded-xl py-2">
          {status}
        </div>
      )}

      {/* ARENA + QUEUE */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ARENA */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-2">Arena</h2>
          <p className="text-sm text-gray-500 mb-4">
            {arena
              ? `Ronde #${arena.round} • ${arena.type}`
              : "Geen ronde actief"}{" "}
            • Max 8 spelers
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sortedPlayers.length
              ? sortedPlayers.map((p, idx) => {
                  const last3 = idx >= sortedPlayers.length - 3;

                  let box =
                    p.status === "eliminated"
                      ? "bg-red-50 border-red-200"
                      : "bg-gray-50 border-gray-200";

                  if (p.status === "alive" && arena?.status === "active" && last3)
                    box = "bg-orange-50 border-orange-200";

                  return (
                    <div
                      key={p.id}
                      className={`rounded-lg p-3 border text-sm shadow ${box}`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-bold">#{idx + 1}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full ${
                            p.status === "alive"
                              ? "bg-[#ff4d4f] text-white"
                              : "bg-gray-300 text-gray-700"
                          }`}
                        >
                          {p.status}
                        </span>
                      </div>

                      <div className="font-semibold truncate">
                        {p.display_name} (@{p.username})
                      </div>

                      <div className="text-xs text-gray-600">
                        Ronde: {fmt(p.diamonds)} 💎
                      </div>

                      {p.status === "alive" && (
                        <button
                          onClick={() =>
                            emitAdminWithUser("admin:eliminate", p.username)
                          }
                          className="mt-2 px-2 py-1 text-[11px] rounded-full border border-red-300 text-red-700 bg-red-50"
                        >
                          Elimineer
                        </button>
                      )}
                    </div>
                  );
                })
              : Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-gray-100 rounded-lg p-3 text-center text-sm text-gray-700"
                  >
                    #{i + 1} – WACHT OP SPELER
                  </div>
                ))}
          </div>
        </div>

        {/* QUEUE */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-2">Wachtrij</h2>
          <p className="text-sm text-gray-500 mb-3">
            {queue.length} speler{queue.length !== 1 && "s"} • Queue:{" "}
            <span
              className={
                queueOpen
                  ? "text-green-600 font-semibold"
                  : "text-red-600 font-semibold"
              }
            >
              {queueOpen ? "OPEN" : "DICHT"}
            </span>
          </p>

          {queue.length ? (
            queue.map((q) => (
              <div
                key={q.tiktok_id}
                className="rounded-lg border border-gray-200 bg-gray-50 p-2 mb-2 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-semibold text-gray-900">
                    {q.display_name} (@{q.username})
                  </div>
                  <div className="text-xs text-gray-500">
                    #{q.position ?? "-"} {q.reason ?? ""}
                  </div>
                </div>

                <div className="flex gap-1 mt-2 sm:mt-0 justify-end">
                  <button
                    onClick={() =>
                      emitAdminWithUser("admin:addToArena", q.username)
                    }
                    className="px-2 py-1 rounded-full border border-[#ff4d4f] text-[#ff4d4f]"
                  >
                    → Arena
                  </button>

                  <button
                    onClick={() =>
                      emitAdminWithUser("admin:removeFromQueue", q.username)
                    }
                    className="px-2 py-1 rounded-full border border-red-300 text-red-700 bg-red-50"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-500 italic">Wachtrij is leeg.</div>
          )}
        </div>
      </section>

      {/* LEADERBOARD + STATS */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* LEADERBOARD */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-2">Leaderboard</h2>
          <p className="text-xs text-gray-500 mb-3">
            Per spel – alleen spelers, host uitgesloten
          </p>

          <div className="max-h-72 overflow-y-auto text-sm">
            {leaderboard.length ? (
              leaderboard.map((e, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between border-b last:border-0 border-gray-200 py-1"
                >
                  <div>
                    <span className="font-mono text-xs text-gray-500 mr-2">
                      #{idx + 1}
                    </span>
                    <span className="font-semibold">
                      {e.display_name} (@{e.username})
                    </span>
                  </div>

                  <span className="font-semibold">
                    {fmt(e.total_diamonds)} 💎
                  </span>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500 italic">
                Geen data beschikbaar.
              </div>
            )}
          </div>
        </div>

        {/* STATS */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-2">Stream stats</h2>
          <p className="text-xs text-gray-500 mb-3">
            Alleen gebaseerd op huidige actieve game-sessie
          </p>

          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600">Game ID</span>
              <span className="font-semibold">
                {gameSession.gameId ?? "–"}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-600">Aantal spelers</span>
              <span className="font-semibold">
                {streamStats ? fmt(streamStats.totalPlayers) : "0"}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-600">Speler diamonds</span>
              <span className="font-semibold">
                {streamStats ? fmt(streamStats.totalPlayerDiamonds) : "0"} 💎
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-600">Host diamonds</span>
              <span className="font-semibold">
                {streamStats ? fmt(streamStats.totalHostDiamonds) : "0"} 💎
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* LOGS */}
      <section className="mt-6 bg-white rounded-2xl shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Log feed</h2>

        <div className="overflow-y-auto max-h-[400px] border border-gray-200 rounded-lg bg-gray-50 text-sm">
          {logs.length ? (
            logs.map((log) => (
              <div
                key={log.id}
                className={`px-3 py-1 border-b last:border-0 ${
                  log.type === "gift"
                    ? "bg-pink-50 text-pink-800"
                    : log.type === "elim"
                    ? "bg-red-50 text-red-700"
                    : log.type === "join"
                    ? "bg-green-50 text-green-700"
                    : "bg-blue-50 text-blue-700"
                }`}
              >
                <span className="font-mono text-xs opacity-60">
                  {new Date(log.timestamp).toLocaleTimeString("nl-NL", {
                    hour12: false,
                  })}
                </span>{" "}
                <strong>{log.type.toUpperCase()}</strong> – {log.message}
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-gray-500 italic">
              Nog geen logs ontvangen.
            </div>
          )}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mt-4 text-xs text-gray-400 text-center">
        BattleBox Engine v{process.env.NEXT_PUBLIC_BATTLEBOX_VERSION || "dev"}
      </footer>
    </main>
  );
}
