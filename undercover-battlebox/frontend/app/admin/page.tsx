"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";

import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  AdminAckResponse,
  AdminSocketOutbound,
  HostProfile,
  ArenaSettings,
  PlayerLeaderboardEntry,
  GifterLeaderboardEntry,
} from "@/lib/adminTypes";

type StreamStats = {
  totalPlayers: number;
  totalPlayerDiamonds: number;
  totalHostDiamonds: number;
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
  // ============================================================
  // CORE STATE
  // ============================================================
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);

  const [playerLeaderboard, setPlayerLeaderboard] =
    useState<PlayerLeaderboardEntry[]>([]);

  const [gifterLeaderboard, setGifterLeaderboard] =
    useState<GifterLeaderboardEntry[]>([]);

  const [activeLbTab, setActiveLbTab] = useState<"players" | "gifters">(
    "players"
  );

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
  const [typing, setTyping] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [activeAutoField, setActiveAutoField] = useState<
    null | "main" | "give" | "use" | "target"
  >(null);

  // ============================================================
  // SOCKET SETUP
  // ============================================================
  useEffect(() => {
    const socket = getAdminSocket();

    socket.on("updateArena", (data: ArenaState) => setArena(data));

    socket.on("updateQueue", (d) => {
      setQueue(d.entries ?? []);
      setQueueOpen(d.open ?? true);
    });

    socket.on("log", (l) =>
      setLogs((prev) => [l, ...prev].slice(0, 200))
    );

    socket.on("initialLogs", (d) => setLogs(d.slice(0, 200)));

    socket.on("streamStats", (s) => setStreamStats(s));
    socket.on("gameSession", (s) => setGameSession(s));

    socket.on("leaderboardPlayers", (rows) => {
      setPlayerLeaderboard(rows);
    });

    socket.on("leaderboardGifters", (rows) => {
      setGifterLeaderboard(rows);
    });

    socket.on("connect_error", () =>
      setStatus("❌ Socket verbinding weggevallen")
    );

    socket.on("round:start", (d) =>
      setStatus(`▶️ Ronde gestart (${d.type}) — ${d.duration}s`)
    );

    socket.on("round:grace", (d) =>
      setStatus(`⏳ Grace-periode actief (${d.grace}s)`)
    );

    socket.on("round:end", () =>
      setStatus("⛔ Ronde beëindigd — voer eliminaties uit")
    );

    return () => {
      socket.off("updateArena");
      socket.off("updateQueue");
      socket.off("log");
      socket.off("initialLogs");
      socket.off("streamStats");
      socket.off("gameSession");
      socket.off("leaderboardPlayers");
      socket.off("leaderboardGifters");
      socket.off("connect_error");
      socket.off("round:start");
      socket.off("round:grace");
      socket.off("round:end");
    };
  }, []);

  // ============================================================
  // INITIAL SNAPSHOT
  // ============================================================
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

      if (snap.playerLeaderboard) setPlayerLeaderboard(snap.playerLeaderboard);
      if (snap.gifterLeaderboard)
        setGifterLeaderboard(snap.gifterLeaderboard);
    });
  }, []);

// ============================================================
  // ADMIN EMITTERS
  // ============================================================
  const emitAdmin = (
    event: keyof AdminSocketOutbound,
    payload?: any
  ) => {
    const socket = getAdminSocket();
    setStatus(`Bezig met ${event}...`);

    socket.emit(event, payload || {}, (res: AdminAckResponse) => {
      setStatus(
        res?.success
          ? "✅ Uitgevoerd"
          : `❌ ${res?.message ?? "Geen antwoord"}`
      );
    });
  };

  const emitAdminWithUser = (
    event: keyof AdminSocketOutbound,
    target?: string
  ) => {
    const socket = getAdminSocket();
    const uname = target || username;

    if (!uname.trim()) return;

    const formatted = uname.startsWith("@") ? uname : `@${uname}`;

    setStatus(`Bezig met ${event}...`);

    socket.emit(event, { username: formatted }, (res: AdminAckResponse) => {
      setStatus(
        res?.success
          ? "✅ Uitgevoerd"
          : `❌ ${res?.message ?? "Geen antwoord"}`
      );
    });
  };

  // ============================================================
  // HELPERS
  // ============================================================
  const fmt = (n: number | undefined) =>
    Number(n ?? 0).toLocaleString("nl-NL", { maximumFractionDigits: 0 });

  const players = useMemo(() => arena?.players ?? [], [arena]);

  const arenaStatus = arena?.status ?? "idle";
  const hasDoomed = players.some((p: any) => p.positionStatus === "elimination");

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

  // ============================================================
  // AUTOCOMPLETE LOGIC
  // ============================================================
  useEffect(() => {
    if (!typing || typing.length < 2) {
      setSearchResults([]);
      return;
    }

    const socket = getAdminSocket();
    const timer = setTimeout(() => {
      socket.emit(
        "admin:searchUsers",
        { query: typing },
        (res: { users: SearchUser[] }) => {
          setSearchResults(res?.users || []);
        }
      );
    }, 150);

    return () => clearTimeout(timer);
  }, [typing]);

  const applyAutoFill = (u: SearchUser) => {
    const formatted = u.username.startsWith("@")
      ? u.username
      : `@${u.username}`;

    if (activeAutoField === "main") setUsername(formatted);
    if (activeAutoField === "give") setTwistUserGive(formatted);
    if (activeAutoField === "use") setTwistUserUse(formatted);
    if (activeAutoField === "target") setTwistTargetUse(formatted);

    setTyping("");
    setShowResults(false);
    setSearchResults([]);
  };

  // ============================================================
  // TIMER BEREKENING
  // ============================================================
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

  const formatTime = (sec: number) => {
    if (!sec || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  };

  // ============================================================
  // POSITION COLORS
  // ============================================================
  const colorForPosition = (p: any) => {
    if (!arena || arena.status === "idle")
      return "bg-gray-50 border-gray-200";

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

  // ============================================================
  // UI START
  // ============================================================
  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">

      {/* ===========================================
          HEADER + TIMER
      ============================================ */}
      <header className="mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold text-[#ff4d4f]">UB</div>
            <div>
              <div className="text-xl font-semibold">
                Undercover BattleBox – Admin
              </div>
              <div className="text-xs text-gray-500">
                Verbonden als{" "}
                <span className="font-semibold text-green-600">Admin</span>
              </div>
            </div>
          </div>

          <div className="text-xs px-3 py-1 rounded-full bg-gray-200 text-gray-800">
            {gameSession.active
              ? `Spel actief (#${gameSession.gameId})`
              : "Geen spel actief"}
          </div>
        </div>

        {/* TIMER */}
        {arena && arena.status !== "idle" && (
          <div className="w-full bg-gray-300 rounded-full h-4 shadow-inner relative overflow-hidden">

            <div
              className={`
                h-4 transition-all duration-300
                ${arena.status === "active" ? "bg-[#ff4d4f]" : ""}
                ${arena.status === "grace" ? "bg-yellow-400" : ""}
                ${arena.status === "ended" ? "bg-gray-600" : ""}
              `}
              style={{ width: `${roundProgress}%` }}
            />

            <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold">
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

      {/* ============================================================
          SPELBESTURING + SPELERSACTIES
      ============================================================ */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* GAME CONTROL */}
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold">Spelbesturing</div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => emitAdmin("admin:startGame")}
              disabled={gameSession.active}
              className={`px-3 py-1.5 rounded-full text-xs ${
                gameSession.active
                  ? "bg-gray-400 text-white cursor-not-allowed"
                  : "bg-green-600 text-white"
              }`}
            >
              Start spel
            </button>

            <button
              onClick={() => emitAdmin("admin:stopGame")}
              disabled={!gameSession.active}
              className={`px-3 py-1.5 rounded-full text-xs ${
                !gameSession.active
                  ? "bg-gray-400 text-white cursor-not-allowed"
                  : "bg-yellow-500 text-white"
              }`}
            >
              Stop spel
            </button>
          </div>

          {/* ROUNDS */}
          <div>
            <div className="text-xs text-gray-600 mb-1">Ronde acties</div>
            <div className="flex gap-2 flex-wrap">

              <button
                onClick={() =>
                  emitAdmin("admin:startRound", { type: "quarter" })
                }
                disabled={!canStartRound}
                className="px-3 py-1.5 bg-[#ff4d4f] text-white rounded-full text-xs disabled:bg-gray-400"
              >
                Start voorronde
              </button>

              <button
                onClick={() =>
                  emitAdmin("admin:startRound", { type: "finale" })
                }
                disabled={!canStartRound}
                className="px-3 py-1.5 bg-gray-900 text-white rounded-full text-xs disabled:bg-gray-400"
              >
                Start finale
              </button>

              <button
                onClick={() => emitAdmin("admin:endRound")}
                disabled={!canStopRound && !canGraceEnd}
                className="px-3 py-1.5 bg-red-600 text-white rounded-full text-xs disabled:bg-gray-400"
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

        {/* ============================================================
            SPELER ACTIES
        ============================================================ */}
        <div className="lg:col-span-2 flex flex-col gap-3">

          <div className="text-sm font-semibold">Speleracties</div>

          <div className="flex flex-col md:flex-row gap-3 md:items-end relative">
            {/* USERNAME INPUT */}
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />

              {/* AUTOCOMPLETE */}
              {showResults &&
                searchResults.length > 0 &&
                activeAutoField === "main" && (
                  <div className="absolute left-0 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-60 overflow-auto">
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
            <div className="flex gap-2 text-xs">
              <button
                onClick={() =>
                  emitAdminWithUser("admin:addToArena", username)
                }
                className="px-3 py-1.5 bg-[#ff4d4f] text-white rounded-full"
              >
                → Arena
              </button>

              <button
                onClick={() =>
                  emitAdminWithUser("admin:addToQueue", username)
                }
                className="px-3 py-1.5 bg-gray-800 text-white rounded-full"
              >
                → Queue
              </button>

              <button
                onClick={() =>
                  emitAdminWithUser("admin:eliminate", username)
                }
                className="px-3 py-1.5 bg-red-600 text-white rounded-full"
              >
                Elimineer
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          ARENA + QUEUE
      ============================================================ */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* ------------------ ARENA ------------------ */}
        <div className="bg-white rounded-2xl shadow p-4">
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
                  <div className="flex justify-between items-center">
                    <span className="font-bold">#{idx + 1}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-300 text-gray-700">
                      {p.positionStatus}
                    </span>
                  </div>

                  <div className="font-semibold truncate">
                    {p.display_name} (@{p.username})
                  </div>

                  <div className="text-xs text-gray-600">
                    Ronde: {fmt(p.diamonds)} 💎
                  </div>

                  {p.positionStatus === "elimination" && (
                    <button
                      onClick={() =>
                        emitAdminWithUser("admin:eliminate", p.username)
                      }
                      className="mt-2 px-2 py-1 text-[11px] rounded-full border border-red-300 text-red-700 bg-red-50"
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
                  className="bg-gray-100 rounded-lg p-3 text-center text-sm text-gray-700"
                >
                  #{i + 1} – WACHT OP SPELER
                </div>
              ))
            )}
          </div>
        </div>

        {/* ------------------ QUEUE ------------------ */}
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

                  <div className="flex flex-wrap gap-1 mt-1">
                    {q.is_vip && (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-yellow-200 text-yellow-900 border border-yellow-400">
                        VIP
                      </span>
                    )}
                    {q.is_fan && !q.is_vip && (
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

                  <div className="mt-1 text-xs text-gray-500">
                    #{q.position} • {q.reason}
                  </div>
                </div>

                <div className="flex gap-1 mt-2 sm:mt-0 justify-end">
                  <button
                    onClick={() =>
                      emitAdminWithUser("admin:promoteUser", q.username)
                    }
                    className="px-2 py-1 rounded-full bg-purple-50 border border-purple-300 text-purple-800 hover:bg-purple-100"
                  >
                    ▲
                  </button>

                  <button
                    onClick={() =>
                      emitAdminWithUser("admin:demoteUser", q.username)
                    }
                    className="px-2 py-1 rounded-full bg-purple-50 border border-purple-300 text-purple-800 hover:bg-purple-100"
                  >
                    ▼
                  </button>

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
            <div className="text-sm text-gray-500 italic">
              Wachtrij is leeg.
            </div>
          )}
        </div>
      </section>

      {/* ============================================================
          LEADERBOARDS
      ============================================================ */}
      <section className="mt-4">
        <div className="bg-white rounded-2xl shadow p-0 overflow-hidden">

          {/* TAB BUTTONS */}
          <div className="w-full flex justify-end p-3 border-b border-gray-200 bg-gray-50">
            <div className="flex gap-2">

              <button
                onClick={() => setActiveLbTab("players")}
                className={`
                  px-4 py-1.5 text-sm rounded-full border 
                  ${activeLbTab === "players"
                    ? "bg-[#ff4d4f] text-white border-[#ff4d4f]"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                  }
                `}
              >
                Players
              </button>

              <button
                onClick={() => setActiveLbTab("gifters")}
                className={`
                  px-4 py-1.5 text-sm rounded-full border
                  ${activeLbTab === "gifters"
                    ? "bg-[#ff4d4f] text-white border-[#ff4d4f]"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                  }
                `}
              >
                Gifters
              </button>

            </div>
          </div>

          {/* TAB CONTENT */}
          <div className="p-4 max-h-96 overflow-y-auto text-sm">

            {/* =======================
                PLAYER LEADERBOARD
            ======================== */}
            {activeLbTab === "players" && (
              <div>
                <h2 className="text-xl font-semibold mb-2">Player Leaderboard</h2>
                <p className="text-xs text-gray-500 mb-3">
                  Diamanten ontvangen (huidige stream)
                </p>

                {playerLeaderboard.length ? (
                  playerLeaderboard.map((e, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between border-b border-gray-200 last:border-0 py-1"
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
                    Geen spelers gevonden.
                  </div>
                )}
              </div>
            )}

            {/* =======================
                GIFTER LEADERBOARD
            ======================== */}
            {activeLbTab === "gifters" && (
              <div>
                <h2 className="text-xl font-semibold mb-2">Gifter Leaderboard</h2>
                <p className="text-xs text-gray-500 mb-3">
                  Diamanten verstuurd (huidige stream)
                </p>

                {gifterLeaderboard.length ? (
                  gifterLeaderboard.map((e, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between border-b border-gray-200 last:border-0 py-1"
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
                    Geen gifters gevonden.
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </section>

      {/* ============================================================
          TWISTS
      ============================================================ */}
      <section className="mt-8 bg-white rounded-2xl shadow p-4">
        <h2 className="text-xl font-semibold mb-4">Twists</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* GIVE TWIST */}
          <div className="p-4 border rounded-xl bg-gray-50 shadow-sm relative">
            <h3 className="font-semibold mb-3">Twist geven</h3>

            <label className="text-xs font-semibold">@username</label>
            <input
              type="text"
              value={twistUserGive}
              onFocus={() => {
                setActiveAutoField("give");
                setShowResults(true);
                setTyping(twistUserGive);
              }}
              onChange={(e) => {
                setTwistUserGive(e.target.value);
                setActiveAutoField("give");
                setTyping(e.target.value);
                setShowResults(true);
              }}
              placeholder="@gebruiker"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
            />

            {/* autocomplete */}
            {showResults &&
              searchResults.length > 0 &&
              activeAutoField === "give" && (
                <div className="absolute left-0 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-60 overflow-auto">
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
              className="mt-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm w-full"
            >
              Geef twist
            </button>
          </div>

          {/* USE TWIST */}
          <div className="p-4 border rounded-xl bg-gray-50 shadow-sm relative">
            <h3 className="font-semibold mb-3">Twist gebruiken</h3>

            <label className="text-xs font-semibold">Gebruiker</label>
            <input
              type="text"
              value={twistUserUse}
              onFocus={() => {
                setActiveAutoField("use");
                setShowResults(true);
                setTyping(twistUserUse);
              }}
              onChange={(e) => {
                setTwistUserUse(e.target.value);
                setActiveAutoField("use");
                setTyping(e.target.value);
                setShowResults(true);
              }}
              placeholder="@gebruiker"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
            />

            {showResults &&
              searchResults.length > 0 &&
              activeAutoField === "use" && (
                <div className="absolute left-0 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-60 overflow-auto">
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
                setShowResults(true);
                setTyping(twistTargetUse);
              }}
              onChange={(e) => {
                setTwistTargetUse(e.target.value);
                setActiveAutoField("target");
                setTyping(e.target.value);
                setShowResults(true);
              }}
              placeholder="@target"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
            />

            {showResults &&
              searchResults.length > 0 &&
              activeAutoField === "target" && (
                <div className="absolute left-0 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-60 overflow-auto">
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
              className="mt-2 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm w-full"
            >
              Gebruik twist
            </button>
          </div>

        </div>
      </section>

      {/* ============================================================
          LOG FEED
      ============================================================ */}
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
                    : log.type === "twist"
                    ? "bg-purple-50 text-purple-700"
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

      <footer className="mt-4 text-xs text-gray-400 text-center">
        BattleBox Engine v3.2 – Danny Stable
      </footer>
    </main>
  );
                }
