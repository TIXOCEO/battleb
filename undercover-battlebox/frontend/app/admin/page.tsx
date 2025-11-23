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

type PlayerLeaderboardEntry = {
  username: string;
  display_name: string;
  tiktok_id: string;
  diamonds_total: number;
};

type GifterLeaderboardEntry = {
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

type SearchUser = {
  tiktok_id: string;
  username: string;
  display_name: string;
};

export default function AdminDashboardPage() {
  // CORE STATE
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);

  // LEADERBOARDS
  const [playerLeaderboard, setPlayerLeaderboard] = useState<PlayerLeaderboardEntry[]>([]);
  const [gifterLeaderboard, setGifterLeaderboard] = useState<GifterLeaderboardEntry[]>([]);
  const [leaderboardTab, setLeaderboardTab] = useState<"players" | "gifters">("players");

  const [gameSession, setGameSession] = useState<GameSessionState>({
    active: false,
    gameId: null,
  });

  // INPUTS
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  // TWISTS
  const [twistUserGive, setTwistUserGive] = useState("");
  const [twistUserUse, setTwistUserUse] = useState("");
  const [twistTargetUse, setTwistTargetUse] = useState("");
  const [twistTypeGive, setTwistTypeGive] = useState("");
  const [twistTypeUse, setTwistTypeUse] = useState("");

  // AUTOCOMPLETE
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [typing, setTyping] = useState("");
  const [activeAutoField, setActiveAutoField] =
    useState<null | "main" | "give" | "use" | "target">(null);

  // CONNECTION STATUS
  const [connected, setConnected] = useState<"connected" | "disconnected" | "connecting">("connecting");

  // SOCKET
  useEffect(() => {
    const socket = getAdminSocket();

    socket.on("connect", () => {
      setConnected("connected");
      setStatus("🟢 Verbonden met server");
    });

    socket.on("disconnect", () => {
      setConnected("disconnected");
      setStatus("🔴 Verbroken");
    });

    socket.on("connect_error", () => {
      setConnected("disconnected");
      setStatus("❌ Socket fout");
    });

    socket.on("updateArena", (data: ArenaState) => setArena(data));
    socket.on("updateQueue", (d: any) => {
      setQueue(d.entries ?? []);
      setQueueOpen(d.open ?? true);
    });

    socket.on("log", (l: LogEntry) =>
      setLogs((prev) => [l, ...prev].slice(0, 200))
    );

    socket.on("initialLogs", (arr: LogEntry[]) => setLogs(arr.slice(0, 200)));
    socket.on("streamStats", (s: StreamStats) => setStreamStats(s));

    socket.on("leaderboardPlayers", (rows: PlayerLeaderboardEntry[]) =>
      setPlayerLeaderboard(rows)
    );
    socket.on("leaderboardGifters", (rows: GifterLeaderboardEntry[]) =>
      setGifterLeaderboard(rows)
    );

    socket.on("gameSession", (s: GameSessionState) => setGameSession(s));

    socket.on("round:start", (d: any) =>
      setStatus(`▶️ Ronde gestart (${d.type}) — ${d.duration}s`)
    );
    socket.on("round:grace", (d: any) =>
      setStatus(`⏳ Grace-periode actief (${d.grace}s)`)
    );
    socket.on("round:end", () =>
      setStatus("⛔ Ronde beëindigd — voer eliminaties uit")
    );

    return () => {
      socket.removeAllListeners();
    };
  }, []);

  // AUTOCOMPLETE QUERY
  useEffect(() => {
    if (!typing.trim() || typing.length < 2) {
      setSearchResults([]);
      return;
    }

    const run = () => {
      const socket = getAdminSocket();
      socket.emit(
        "admin:searchUsers",
        { query: typing },
        (res: { users: SearchUser[] }) => {
          setSearchResults(res?.users || []);
        }
      );
    };

    const timer = setTimeout(run, 150);
    return () => clearTimeout(timer);
  }, [typing]);

  // APPLY AUTOFILL
  const applyAutoFill = (u: SearchUser) => {
    const formatted = "@" + u.username.toLowerCase();

    if (activeAutoField === "main") setUsername(formatted);
    if (activeAutoField === "give") setTwistUserGive(formatted);
    if (activeAutoField === "use") setTwistUserUse(formatted);
    if (activeAutoField === "target") setTwistTargetUse(formatted);

    setShowResults(false);
    setTyping("");
    setSearchResults([]);
  };

  // ADMIN HELPERS
  const emitAdmin = (event: string, payload?: any) => {
    const socket = getAdminSocket();
    setStatus(`Bezig met ${event}...`);
    socket.emit(event, payload || {}, (res: AdminAckResponse) => {
      setStatus(
        res?.success ? "✅ Uitgevoerd" : `❌ ${res?.message ?? "Geen antwoord"}`
      );
    });
  };

  const emitAdminWithUser = (event: string, raw?: string) => {
    let u = raw || username;
    if (!u.trim()) return;

    const formatted = u.startsWith("@")
      ? u.toLowerCase()
      : `@${u.toLowerCase()}`;

    emitAdmin(event, { username: formatted });
  };

  const fmt = (n: number) =>
    n.toLocaleString("nl-NL", { maximumFractionDigits: 0 });

  // FINAL SCORE
  const players = useMemo(() => {
    if (!arena) return [];
    return arena.players.map((p: any) => ({
      ...p,
      finalScore:
        arena.type === "finale"
          ? (p._total ?? 0) + p.diamonds
          : p.diamonds,
    }));
  }, [arena]);

  // COLORS
  const colorForPosition = (p: any) => {
    if (!arena || arena.status === "idle") {
      return "bg-gray-50 border-gray-200";
    }
    switch (p.positionStatus) {
      case "immune":
        return "bg-green-100 border-green-300";
      case "danger":
        return "bg-orange-100 border-orange-300";
      case "elimination":
        return "bg-red-200 border-red-400";
      default:
        return "bg-gray-50 border-gray-200";
    }
  };

  // ROUND STATE
  const arenaStatus = arena?.status ?? "idle";
  const hasDoomed =
    players?.some((p: any) => p.positionStatus === "elimination") ?? false;

  const canStartRound =
    !!arena &&
    (arenaStatus === "idle" || arenaStatus === "ended") &&
    !hasDoomed;

  const canStopRound = arenaStatus === "active";
  const canGraceEnd = arenaStatus === "grace";
  const needsElimination =
    (arena?.settings?.forceEliminations ?? true) &&
    arenaStatus === "ended" &&
    hasDoomed;

  // TIMER
  const roundProgress = useMemo(() => {
    if (!arena) return 0;
    const now = Date.now();

    if (arena.status === "active") {
      const start = arena.roundStartTime;
      const end = arena.roundCutoff;
      return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
    }

    if (arena.status === "grace") {
      const start = arena.roundCutoff;
      const end = arena.graceEnd;
      return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
    }

    return 0;
  }, [arena]);

  function formatTime(sec: number) {
    if (!sec || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }

  // ============================  
  // RENDER  
  // ============================  

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">

      {/* HEADER */}
      <header className="mb-6">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-2 mb-2">

          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold text-[#ff4d4f]">UB</div>
            <div>
              <div className="text-xl font-semibold">
                Undercover BattleBox – Admin
              </div>
              <div className="text-xs text-gray-500">
                Verbonden als{" "}
                <span className="text-green-600 font-semibold">Admin</span>
              </div>
            </div>
          </div>

          <div
            className={`px-3 py-1 rounded-full text-xs ${
              connected === "connected"
                ? "bg-green-200 text-green-800"
                : connected === "connecting"
                ? "bg-yellow-200 text-yellow-800"
                : "bg-red-200 text-red-800"
            }`}
          >
            {connected === "connected"
              ? "🟢 Verbonden"
              : connected === "connecting"
              ? "🟡 Verbinden…"
              : "🔴 Verbroken"}
          </div>
        </div>

        {/* Progressbar */}
        {arena && arena.status !== "idle" && (
          <div className="w-full h-4 bg-gray-300 rounded-full shadow-inner relative overflow-hidden">
            <div
              className={`h-4 transition-all duration-300 ${
                arena.status === "active"
                  ? "bg-[#ff4d4f]"
                  : arena.status === "grace"
                  ? "bg-yellow-400"
                  : "bg-gray-600"
              }`}
              style={{ width: `${roundProgress}%` }}
            />
            <div className="absolute inset-0 flex justify-center items-center text-xs font-semibold">
              {arena.status === "active" &&
                formatTime(
                  Math.max(
                    0,
                    Math.floor((arena.roundCutoff - Date.now()) / 1000)
                  )
                )}

              {arena.status === "grace" &&
                formatTime(
                  Math.max(
                    0,
                    Math.floor((arena.graceEnd - Date.now()) / 1000)
                  )
                )}

              {arena.status === "ended" && "00:00"}
            </div>
          </div>
        )}
      </header>

      {/* SPELBESTURING */}
      <section className="bg-white p-4 rounded-2xl shadow mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="flex flex-col gap-3">

          <div className="text-sm font-semibold">Spelbesturing</div>

          <div className="flex gap-2 flex-wrap">
            <button
              disabled={gameSession.active}
              onClick={() => emitAdmin("admin:startGame")}
              className={`px-3 py-1.5 text-xs rounded-full ${
                gameSession.active
                  ? "bg-gray-400 cursor-not-allowed text-white"
                  : "bg-green-600 text-white"
              }`}
            >
              Start spel
            </button>

            <button
              disabled={!gameSession.active}
              onClick={() => emitAdmin("admin:stopGame")}
              className={`px-3 py-1.5 text-xs rounded-full ${
                !gameSession.active
                  ? "bg-gray-400 cursor-not-allowed text-white"
                  : "bg-yellow-500 text-white"
              }`}
            >
              Stop spel
            </button>
          </div>

          <div>
            <div className="text-xs text-gray-600 mb-1">Ronde acties</div>

            <div className="flex gap-2 flex-wrap">
              <button
                disabled={!canStartRound}
                onClick={() => emitAdmin("admin:startRound", { type: "quarter" })}
                className="px-3 py-1.5 rounded-full text-xs bg-[#ff4d4f] text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Start voorronde
              </button>

              <button
                disabled={!canStartRound}
                onClick={() => emitAdmin("admin:startRound", { type: "finale" })}
                className="px-3 py-1.5 rounded-full text-xs bg-gray-900 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Start finale
              </button>

              <button
                disabled={!canStopRound && !canGraceEnd}
                onClick={() => emitAdmin("admin:endRound")}
                className="px-3 py-1.5 rounded-full text-xs bg-red-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Stop ronde
              </button>
            </div>

            {needsElimination && (
              <p className="mt-2 text-xs text-red-600">
                ⚠ Eerst alle eliminaties uitvoeren!
              </p>
            )}
          </div>
        </div>

        {/* SPELERACTIES (met VIP + FAN) */}
        <div className="lg:col-span-2 flex flex-col gap-3">

          <div className="text-sm font-semibold">Speleracties</div>

          <div className="flex flex-col md:flex-row gap-3 md:items-end relative">

            <div className="flex-1">
              <label className="text-xs text-gray-600 font-semibold mb-1 block">
                @username (zoek)
              </label>
              <input
                type="text"
                value={username}
                onFocus={() => {
                  setActiveAutoField("main");
                  setTyping(username);
                  setShowResults(true);
                }}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setActiveAutoField("main");
                  setTyping(e.target.value);
                  setShowResults(true);
                }}
                placeholder="@zoeken"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />

              {/* AUTOCOMPLETE */}
              {showResults &&
                searchResults.length > 0 &&
                activeAutoField === "main" && (
                  <div className="absolute z-40 bg-white border border-gray-300 w-full mt-1 rounded-lg shadow max-h-60 overflow-auto">
                    {searchResults.map((u) => (
                      <div
                        key={u.tiktok_id}
                        onClick={() => applyAutoFill(u)}
                        className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer"
                      >
                        <span className="font-semibold">{u.display_name}</span>{" "}
                        <span className="text-gray-500">@{u.username}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            {/* ACTION BUTTONS */}
            <div className="flex flex-wrap gap-2 text-xs">

              <button
                onClick={() => emitAdminWithUser("admin:addToArena", username)}
                className="px-3 py-1.5 rounded-full bg-[#ff4d4f] text-white"
              >
                → Arena
              </button>

              <button
                onClick={() => emitAdminWithUser("admin:addToQueue", username)}
                className="px-3 py-1.5 rounded-full bg-gray-800 text-white"
              >
                → Queue
              </button>

              <button
                onClick={() => emitAdminWithUser("admin:eliminate", username)}
                className="px-3 py-1.5 rounded-full bg-red-600 text-white"
              >
                Elimineer
              </button>

              {/* NEW: VIP GEVEN */}
              <button
                onClick={() => emitAdminWithUser("admin:giveVip", username)}
                className="px-3 py-1.5 rounded-full bg-yellow-500 text-white"
              >
                Geef VIP
              </button>

              {/* NEW: VIP VERWIJDEREN */}
              <button
                onClick={() => emitAdminWithUser("admin:removeVip", username)}
                className="px-3 py-1.5 rounded-full bg-yellow-700 text-white"
              >
                Remove VIP
              </button>

              {/* NEW: FAN GEVEN */}
              <button
                onClick={() => emitAdminWithUser("admin:giveFan", username)}
                className="px-3 py-1.5 rounded-full bg-blue-600 text-white"
              >
                Geef FAN (24u)
              </button>

            </div>
          </div>
        </div>
      </section>

      {/* STATUS */}
      {status && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 py-2 px-4 text-center rounded-xl mb-4 text-sm">
          {status}
        </div>
      )}

      {/* ARENA & QUEUE */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ARENA */}
        <div className="bg-white p-4 rounded-2xl shadow">
          <h2 className="text-xl font-semibold mb-2">Arena</h2>
          <p className="text-sm text-gray-500 mb-4">
            {arena
              ? `Ronde #${arena.round} • ${arena.type} • ${arena.status}`
              : "Geen ronde actief"}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {players.length ? (
              players.map((p, idx) => (
                <div
                  key={p.id}
                  className={`rounded-lg p-3 border text-sm shadow ${colorForPosition(
                    p
                  )}`}
                >
                  <div className="flex justify-between">
                    <span className="font-bold">#{idx + 1}</span>
                    <span className="px-2 py-0.5 text-[10px] bg-gray-300 text-gray-700 rounded-full">
                      {p.positionStatus}
                    </span>
                  </div>

                  <div className="font-semibold truncate">
                    {p.display_name} (@{p.username})
                  </div>

                  <div className="text-xs text-gray-600">
                    {arena?.type === "finale"
                      ? `Finale score: ${fmt(p.finalScore)} 💎`
                      : `Ronde: ${fmt(p.diamonds)} 💎`}
                  </div>

                  {p.positionStatus === "elimination" && (
                    <button
                      onClick={() =>
                        emitAdminWithUser("admin:eliminate", p.username)
                      }
                      className="mt-2 px-2 py-1 text-[11px] bg-red-50 text-red-700 border-red-300 rounded-full border"
                    >
                      Verwijder speler
                    </button>
                  )}
                </div>
              ))
            ) : (
              Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-gray-100 rounded-lg p-3 text-sm text-center text-gray-700"
                >
                  #{i + 1} – WACHT OP SPELER
                </div>
              ))
            )}
          </div>
        </div>

        {/* QUEUE */}
        <div className="bg-white p-4 rounded-2xl shadow">
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
                className="bg-gray-50 border border-gray-200 p-2 rounded-lg mb-2 shadow-sm text-sm flex flex-col sm:flex-row sm:justify-between"
              >
                <div>
                  <div className="font-semibold text-gray-900">
                    {q.display_name} (@{q.username})
                  </div>

                  <div className="flex flex-wrap gap-1 mt-1">
                    {q.is_vip && (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-yellow-200 text-yellow-900 border border-yellow-400">
                        VIP
                      </span>
                    )}

                    {!q.is_vip && q.is_fan && (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-700 border border-blue-300">
                        Fan
                      </span>
                    )}

                    {q.priorityDelta > 0 && (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-purple-100 text-purple-700 border border-purple-300">
                        Boost +{q.priorityDelta}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-gray-500 mt-1">
                    #{q.position} • {q.reason}
                  </div>
                </div>

                <div className="flex gap-1 mt-2 sm:mt-0">

                  <button
                    onClick={() =>
                      emitAdminWithUser("admin:promoteUser", q.username)
                    }
                    className="px-2 py-1 bg-purple-50 text-purple-800 border border-purple-300 rounded-full text-xs"
                  >
                    ▲
                  </button>

                  <button
                    onClick={() =>
                      emitAdminWithUser("admin:demoteUser", q.username)
                    }
                    className="px-2 py-1 bg-purple-50 text-purple-800 border border-purple-300 rounded-full text-xs"
                  >
                    ▼
                  </button>

                  <button
                    onClick={() =>
                      emitAdminWithUser("admin:addToArena", q.username)
                    }
                    className="px-2 py-1 border border-[#ff4d4f] text-[#ff4d4f] rounded-full text-xs"
                  >
                    → Arena
                  </button>

                  <button
                    onClick={() =>
                      emitAdminWithUser("admin:removeFromQueue", q.username)
                    }
                    className="px-2 py-1 bg-red-50 text-red-700 border border-red-300 rounded-full text-xs"
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
        <div className="bg-white p-4 rounded-2xl shadow">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xl font-semibold">Leaderboard</h2>

            <div className="flex gap-2">
              <button
                onClick={() => setLeaderboardTab("players")}
                className={`px-3 py-1 text-xs rounded-full ${
                  leaderboardTab === "players"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-800"
                }`}
              >
                Players
              </button>

              <button
                onClick={() => setLeaderboardTab("gifters")}
                className={`px-3 py-1 text-xs rounded-full ${
                  leaderboardTab === "gifters"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-800"
                }`}
              >
                Gifters
              </button>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto text-sm border-t pt-2">
            {/* PLAYER LB */}
            {leaderboardTab === "players" &&
              (playerLeaderboard.length ? (
                playerLeaderboard.map((e, idx) => (
                  <div
                    key={idx}
                    className="py-1 flex justify-between border-b last:border-0"
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
                      {fmt(e.diamonds_total)} 💎
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-500 italic">
                  Geen data beschikbaar.
                </div>
              ))}

            {/* GIFTER LB */}
            {leaderboardTab === "gifters" &&
              (gifterLeaderboard.length ? (
                gifterLeaderboard.map((e, idx) => (
                  <div
                    key={idx}
                    className="py-1 flex justify-between border-b last:border-0"
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
              ))}
          </div>
        </div>

        {/* STREAM STATS */}
        <div className="bg-white p-4 rounded-2xl shadow">
          <h2 className="text-xl font-semibold mb-2">Stream stats</h2>
          <p className="text-xs text-gray-500 mb-3">
            Gebaseerd op actieve game-sessie
          </p>

          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600">Game ID</span>
              <span className="font-semibold">{gameSession.gameId ?? "–"}</span>
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

      {/* TWISTS */}
      <section className="bg-white rounded-2xl shadow p-4 mt-8">
        <h2 className="text-xl font-semibold mb-4">Twists</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* GIVE */}
          <div className="bg-gray-50 border rounded-xl p-4 shadow-sm relative">
            <h3 className="font-semibold mb-3">Twist geven</h3>

            <label className="text-xs font-semibold">@username</label>
            <input
              type="text"
              value={twistUserGive}
              onFocus={() => {
                setActiveAutoField("give");
                setTyping(twistUserGive);
                setShowResults(true);
              }}
              onChange={(e) => {
                setTwistUserGive(e.target.value);
                setActiveAutoField("give");
                setTyping(e.target.value);
              }}
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
            />

            {showResults &&
              searchResults.length > 0 &&
              activeAutoField === "give" && (
                <div className="absolute bg-white border border-gray-300 w-full mt-1 rounded-lg shadow max-h-60 overflow-auto z-20">
                  {searchResults.map((u) => (
                    <div
                      key={u.tiktok_id}
                      onClick={() => applyAutoFill(u)}
                      className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer"
                    >
                      <span className="font-semibold">{u.display_name}</span>{" "}
                      <span className="text-gray-500">@{u.username}</span>
                    </div>
                  ))}
                </div>
              )}

            <label className="text-xs font-semibold">Kies twist</label>
            <select
              value={twistTypeGive}
              onChange={(e) => setTwistTypeGive(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
            >
              <option value="">-- Kies twist --</option>
              <option value="galaxy">Galaxy</option>
              <option value="moneygun">MoneyGun</option>
              <option value="immune">Immune</option>
              <option value="heal">Heal</option>
              <option value="bomb">Bomb</option>
              <option value="diamond_pistol">Diamond Pistol</option>
            </select>

            <button
              onClick={() =>
                emitAdmin("admin:giveTwist", {
                  username: twistUserGive,
                  twist: twistTypeGive,
                })
              }
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm w-full"
            >
              Geef twist
            </button>
          </div>

          {/* USE */}
          <div className="bg-gray-50 border rounded-xl p-4 shadow-sm relative">
            <h3 className="font-semibold mb-3">Twist gebruiken (admin)</h3>

            <label className="text-xs font-semibold">Gebruiker</label>
            <input
              type="text"
              value={twistUserUse}
              onFocus={() => {
                setActiveAutoField("use");
                setTyping(twistUserUse);
                setShowResults(true);
              }}
              onChange={(e) => {
                setTwistUserUse(e.target.value);
                setActiveAutoField("use");
                setTyping(e.target.value);
              }}
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
            />

            {showResults &&
              searchResults.length > 0 &&
              activeAutoField === "use" && (
                <div className="absolute bg-white border border-gray-300 w-full mt-1 rounded-lg shadow max-h-60 overflow-auto z-20">
                  {searchResults.map((u) => (
                    <div
                      key={u.tiktok_id}
                      onClick={() => applyAutoFill(u)}
                      className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer"
                    >
                      <span className="font-semibold">{u.display_name}</span>{" "}
                      <span className="text-gray-500">@{u.username}</span>
                    </div>
                  ))}
                </div>
              )}

            <label className="text-xs font-semibold">Twist</label>
            <select
              value={twistTypeUse}
              onChange={(e) => setTwistTypeUse(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
            >
              <option value="">-- Kies twist --</option>
              <option value="galaxy">Galaxy</option>
              <option value="moneygun">MoneyGun</option>
              <option value="immune">Immune</option>
              <option value="heal">Heal</option>
              <option value="bomb">Bomb</option>
              <option value="diamond_pistol">Diamond Pistol</option>
            </select>

            <label className="text-xs font-semibold">
              Target speler (optioneel)
            </label>
            <input
              type="text"
              value={twistTargetUse}
              onFocus={() => {
                setActiveAutoField("target");
                setTyping(twistTargetUse);
                setShowResults(true);
              }}
              onChange={(e) => {
                setTwistTargetUse(e.target.value);
                setActiveAutoField("target");
                setTyping(e.target.value);
              }}
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
            />

            {showResults &&
              searchResults.length > 0 &&
              activeAutoField === "target" && (
                <div className="absolute bg-white border border-gray-300 w-full mt-1 rounded-lg shadow max-h-60 overflow-auto z-20">
                  {searchResults.map((u) => (
                    <div
                      key={u.tiktok_id}
                      onClick={() => applyAutoFill(u)}
                      className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer"
                    >
                      <span className="font-semibold">{u.display_name}</span>{" "}
                      <span className="text-gray-500">@{u.username}</span>
                    </div>
                  ))}
                </div>
              )}

            <button
              onClick={() =>
                emitAdmin("admin:useTwist", {
                  username: twistUserUse,
                  twist: twistTypeUse,
                  target: twistTargetUse,
                })
              }
              className="px-3 py-2 bg-purple-600 text-white rounded-lg text-sm w-full"
            >
              Gebruik twist
            </button>
          </div>
        </div>
      </section>

      {/* LOG FEED */}
      <section className="bg-white rounded-2xl shadow p-4 mt-6">
        <h2 className="text-lg font-semibold mb-2">Log feed</h2>

        <div className="max-h-[400px] overflow-y-auto border border-gray-200 rounded-lg bg-gray-50 text-sm">
          {logs.length ? (
            logs.map((log) => (
              <div
                key={log.id}
                className={`
                  px-3 py-1 border-b last:border-0
                  ${
                    log.type === "gift"
                      ? "bg-pink-50 text-pink-800"
                      : log.type === "elim"
                      ? "bg-red-50 text-red-700"
                      : log.type === "join"
                      ? "bg-green-50 text-green-700"
                      : log.type === "twist"
                      ? "bg-purple-50 text-purple-700"
                      : "bg-blue-50 text-blue-700"
                  }
                `}
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

      <footer className="mt-4 text-center text-xs text-gray-400">
        BattleBox Engine v4.1 – Danny Stable Final
      </footer>
    </main>
  );
}
