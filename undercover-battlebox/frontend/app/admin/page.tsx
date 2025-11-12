"use client";

import React, { useEffect, useState } from "react";
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

  // ✅ Socket setup + cleanup
  useEffect(() => {
    const socket = getAdminSocket();

    socket.on("updateArena", setArena);
    socket.on("updateQueue", (d: any) => {
      setQueue(d.entries ?? []);
      setQueueOpen(d.open ?? true);
    });
    socket.on("log", (l: LogEntry) =>
      setLogs((p) => [l, ...p].slice(0, 200))
    );
    socket.on("initialLogs", (d: LogEntry[]) =>
      setLogs(d.slice(0, 200))
    );

    socket.on("streamStats", (s: StreamStats) => setStreamStats(s));
    socket.on(
      "streamLeaderboard",
      (entries: LeaderboardEntry[]) => setLeaderboard(entries)
    );
    socket.on("gameSession", (session: GameSessionState) =>
      setGameSession(session)
    );

    socket.on("connect_error", (err: any) => {
      console.error("❌ Socket connectie-fout:", err?.message || err);
      setStatus("❌ Socket verbinding verbroken");
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  // Helper om acties uit te voeren vanuit UI
  const emitAdmin = (event: string, target?: string) => {
    const socket = getAdminSocket();
    const uname = target || username;
    if (!uname.trim()) return;
    const u = uname.startsWith("@") ? uname : `@${uname}`;
    setStatus(`Bezig met ${event}...`);
    socket.emit(event, { username: u }, (res: AdminAckResponse) =>
      setStatus(res.success ? "✅ Succesvol uitgevoerd" : `❌ ${res.message}`)
    );
  };

  const fmtNumber = (n: number) =>
    n.toLocaleString("nl-NL", { maximumFractionDigits: 0 });

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-6">
        <div className="flex items-center gap-2">
          <div className="text-2xl font-bold text-[#ff4d4f]">UB</div>
          <div>
            <div className="text-lg md:text-xl font-semibold">
              Undercover BattleBox – Admin
            </div>
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
                : "bg-gray-200 text-gray-700"
            }`}
          >
            {gameSession.active
              ? `Spel actief (Game #${gameSession.gameId ?? "?"})`
              : "Geen spel actief"}
          </span>
        </div>
      </header>

      {/* ADMIN INPUT + GAME CONTROLS */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-col md:flex-row gap-3 items-start md:items-end">
        <div className="flex-1">
          <label className="text-xs text-gray-600 font-semibold mb-1 block">
            @username toevoegen / verwijderen
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="@gebruikersnaam"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff4d4f]/70"
          />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            onClick={() => emitAdmin("admin:addToArena")}
            className="px-3 py-1.5 bg-[#ff4d4f] text-white rounded-full"
          >
            Naar Arena
          </button>
          <button
            onClick={() => emitAdmin("admin:addToQueue")}
            className="px-3 py-1.5 bg-gray-800 text-white rounded-full"
          >
            Naar Queue
          </button>
          <button
            onClick={() => emitAdmin("admin:eliminate")}
            className="px-3 py-1.5 bg-red-600 text-white rounded-full"
          >
            Elimineer
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs ml-auto">
          <button
            onClick={() => emitAdmin("admin:startGame")}
            className="px-3 py-1.5 bg-green-600 text-white rounded-full"
          >
            Start spel
          </button>
          <button
            onClick={() => emitAdmin("admin:stopGame")}
            className="px-3 py-1.5 bg-yellow-500 text-white rounded-full"
          >
            Stop spel
          </button>
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
          <h2 className="text-xl font-semibold mb-1">Arena</h2>
          <p className="text-sm text-gray-500 mb-4">
            {arena
              ? `Ronde #${arena.round} • ${arena.type}`
              : "Geen ronde actief"}{" "}
            • Max 8 deelnemers
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {arena?.players?.length
              ? arena.players.map((p, i) => (
                  <div
                    key={p.id}
                    className={`rounded-lg p-3 border text-sm shadow-sm ${
                      p.status === "alive"
                        ? "bg-gray-50 border-gray-200"
                        : "bg-red-50 border-red-200"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-gray-700">#{i + 1}</span>
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
                    <div className="font-semibold text-gray-900 truncate">
                      {p.display_name} (@{p.username.replace(/^@+/, "")})
                    </div>
                    <div className="text-xs text-gray-600">
                      Ronde: {fmtNumber(p.diamonds)} 💎
                    </div>
                    {p.status === "alive" && (
                      <button
                        onClick={() =>
                          emitAdmin("admin:eliminate", p.username)
                        }
                        className="mt-2 px-2 py-1 text-[11px] rounded-full border border-red-200 text-red-600 bg-red-50 hover:bg-red-100"
                      >
                        Elimineer
                      </button>
                    )}
                  </div>
                ))
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
          <h2 className="text-xl font-semibold mb-1">Wachtrij</h2>
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
                    {q.display_name} (@{q.username.replace(/^@+/, "")})
                  </div>
                  <div className="text-xs text-gray-500">
                    #{q.position ?? "-"} {q.reason ?? ""}
                  </div>
                </div>
                <div className="flex gap-1 mt-2 sm:mt-0 justify-end">
                  <button
                    onClick={() => emitAdmin("admin:addToArena", q.username)}
                    className="px-2 py-1 rounded-full border border-[#ff4d4f] text-[#ff4d4f] hover:bg-[#ff4d4f]/10"
                  >
                    → Arena
                  </button>
                  <button
                    onClick={() =>
                      emitAdmin("admin:removeFromQueue", q.username)
                    }
                    className="px-2 py-1 rounded-full border border-red-200 text-red-600 bg-red-50 hover:bg-red-100"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-500 italic">
              Wachtrij is leeg.
            </div>
          )}
        </div>
      </section>

      {/* STREAM LEADERBOARD + STATS */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* LEADERBOARD */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-2">Stream leaderboard</h2>
          <p className="text-xs text-gray-500 mb-3">
            Diamonds per speler (alleen ontvangers, exclusief host) binnen
            huidig spel.
          </p>
          <div className="max-h-72 overflow-y-auto text-sm">
            {leaderboard.length ? (
              leaderboard.map((e, idx) => (
                <div
                  key={`${e.user_id}-${idx}`}
                  className="flex items-center justify-between border-b last:border-0 border-gray-100 py-1"
                >
                  <div>
                    <span className="font-mono text-xs text-gray-500 mr-2">
                      #{idx + 1}
                    </span>
                    <span className="font-semibold text-gray-900">
                      {e.display_name} (@{e.username})
                    </span>
                  </div>
                  <div className="font-semibold text-gray-800">
                    {fmtNumber(e.total_diamonds)} 💎
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500 italic">
                Nog geen spelers in leaderboard.
              </div>
            )}
          </div>
        </div>

        {/* STATS */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-2">Stream stats</h2>
          <p className="text-xs text-gray-500 mb-3">
            Per spel (Game) – gebaseerd op gifts in huidige sessie.
          </p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Game ID</span>
              <span className="font-semibold text-gray-900">
                {gameSession.active
                  ? gameSession.gameId ?? "-"
                  : gameSession.gameId ?? "–"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Aantal spelers</span>
              <span className="font-semibold text-gray-900">
                {streamStats ? fmtNumber(streamStats.totalPlayers) : "0"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Totaal speler diamonds</span>
              <span className="font-semibold text-gray-900">
                {streamStats
                  ? fmtNumber(streamStats.totalPlayerDiamonds)
                  : "0"}{" "}
                💎
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Totaal host diamonds</span>
              <span className="font-semibold text-gray-900">
                {streamStats
                  ? fmtNumber(streamStats.totalHostDiamonds)
                  : "0"}{" "}
                💎
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* LOG FEED */}
      <section className="mt-6 bg-white rounded-2xl shadow p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Log Feed</h2>
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
                    : log.type === "system"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-gray-50 text-gray-700"
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
      <footer className="mt-4 text-xs text-gray-400 text-center">
  BattleBox Engine v{process.env.NEXT_PUBLIC_BATTLEBOX_VERSION || "dev"}
</footer>
    </main>
  );
              }
