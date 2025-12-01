"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { getAdminSocket } from "@/lib/socketClient";

import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  AdminAckResponse,
  AdminSocketOutbound,
  SearchUser,
  PlayerLeaderboardEntry,
  GifterLeaderboardEntry,
} from "@/lib/adminTypes";

/* ============================================
   LOCAL TYPES
============================================ */
type StreamStats = {
  totalPlayers: number;
  totalPlayerDiamonds: number;
  totalHostDiamonds: number;
};

type GameSessionState = {
  active: boolean;
  gameId: number | null;
};

type ConfirmState = {
  message: string;
  onConfirm: () => void;
};

export default function AdminDashboardPage() {
  /* ============================================
     CORE STATE
  ============================================ */
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);

  const [playerLeaderboard, setPlayerLeaderboard] =
    useState<PlayerLeaderboardEntry[]>([]);
  const [gifterLeaderboard, setGifterLeaderboard] =
    useState<GifterLeaderboardEntry[]>([]);

  const [activeLbTab, setActiveLbTab] =
    useState<"players" | "gifters">("players");

  const [gameSession, setGameSession] = useState<GameSessionState>({
    active: false,
    gameId: null,
  });

  const [hostDiamonds, setHostDiamonds] = useState(0);

  /* USER INPUTS */
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  /* TWISTS */
  const [twistUserGive, setTwistUserGive] = useState("");
  const [twistUserUse, setTwistUserUse] = useState("");
  const [twistTargetUse, setTwistTargetUse] = useState("");
  const [twistTypeGive, setTwistTypeGive] = useState("");
  const [twistTypeUse, setTwistTypeUse] = useState("");

  /* AUTOCOMPLETE */
  const [typing, setTyping] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [activeAutoField, setActiveAutoField] = useState<
    null | "main" | "give" | "use" | "target"
  >(null);

  /* CONFIRM POPUP STATE */
  const [confirmData, setConfirmData] = useState<ConfirmState | null>(null);

  const autoRef = useRef<HTMLDivElement | null>(null);

  const openConfirm = (data: ConfirmState) => setConfirmData(data);
  const cancelConfirm = () => setConfirmData(null);

  /* ============================================
     CLICK OUTSIDE AUTOCOMPLETE
  ============================================ */
  useEffect(() => {
    function handler(e: any) {
      if (autoRef.current && !autoRef.current.contains(e.target)) {
        setShowResults(false);
        setActiveAutoField(null);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* ============================================
     SOCKET SETUP
  ============================================ */
  useEffect(() => {
    const socket = getAdminSocket();

    socket.on("updateArena", (data) => setArena(data));
    socket.on("updateQueue", (d) => {
      setQueue(d.entries ?? []);
      setQueueOpen(d.open ?? true);
    });

    socket.on("log", (l) => setLogs((p) => [l, ...p].slice(0, 200)));
    socket.on("initialLogs", (d) => setLogs(d.slice(0, 200)));

    socket.on("streamStats", (s) => setStreamStats(s));
    socket.on("gameSession", (s) => setGameSession(s));

    socket.on("leaderboardPlayers", (rows) => setPlayerLeaderboard(rows));
    socket.on("leaderboardGifters", (rows) => setGifterLeaderboard(rows));

    socket.on("hostDiamonds", (d) => setHostDiamonds(d.total));

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
      setStatus("❌ Socket verbinding weggevallen")
    );

    return () => {
      socket.removeAllListeners();
    };
  }, []);

  /* ============================================
     INITIAL SNAPSHOT
  ============================================ */
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
      if (snap.stats) setStreamStats(snap.stats);
      if (snap.gameSession) setGameSession(snap.gameSession);

      if (snap.playerLeaderboard)
        setPlayerLeaderboard(snap.playerLeaderboard);

      if (snap.gifterLeaderboard)
        setGifterLeaderboard(snap.gifterLeaderboard);
    });
  }, []);

  /* ============================================
     RONDE TIMER REALTIME UPDATE
  ============================================ */
  useEffect(() => {
    const t = setInterval(() => {
      setArena((a) => (a ? { ...a } : a));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* ============================================
     EMITTER HELPERS
  ============================================ */
  const emitAdmin = (
    event: keyof AdminSocketOutbound,
    payload?: any
  ) => {
    const socket = getAdminSocket();
    setStatus(`Bezig met ${event}...`);

    socket.emit(event, payload ?? {}, (res: AdminAckResponse) => {
      setStatus(
        res?.success ? "✅ Uitgevoerd" : `❌ ${res?.message ?? "Geen antwoord"}`
      );
    });
  };

  const emitAdminWithUser = (
    event: keyof AdminSocketOutbound,
    userTarget?: string
  ) => {
    const uname = (userTarget || username || "").trim();
    if (!uname) return;

    const socket = getAdminSocket();
    const formatted = uname.startsWith("@") ? uname : `@${uname}`;

    setStatus(`Bezig met ${event}...`);
    socket.emit(event, { username: formatted }, (res: AdminAckResponse) => {
      setStatus(res?.success ? "✅ Uitgevoerd" : `❌ ${res?.message}`);
    });
  };

  /* ============================================
     AUTOCOMPLETE SEARCH
  ============================================ */
  useEffect(() => {
    const q = typing.trim().replace(/^@+/, "");
    if (!q || q.length < 2) {
      setSearchResults([]);
      return;
    }

    const socket = getAdminSocket();
    const handle = setTimeout(() => {
      socket.emit(
        "searchUsers",
        { query: q },
        (res: { users: SearchUser[] }) => {
          setSearchResults(res?.users || []);
        }
      );
    }, 250);

    return () => clearTimeout(handle);
  }, [typing]);

  function applyAutoFill(user: SearchUser) {
    if (!user) return;

    const formatted = user.username.startsWith("@")
      ? user.username
      : `@${user.username}`;

    if (activeAutoField === "main") setUsername(formatted);
    if (activeAutoField === "give") setTwistUserGive(formatted);
    if (activeAutoField === "use") setTwistUserUse(formatted);
    if (activeAutoField === "target") setTwistTargetUse(formatted);

    setTyping("");
    setSearchResults([]);
    setShowResults(false);
    setActiveAutoField(null);
  }

  /* ============================================
     HELPERS
  ============================================ */
  const fmt = (n: number | string | undefined | null) =>
    Number(n ?? 0).toLocaleString("nl-NL");

  const players = useMemo(() => arena?.players ?? [], [arena]);
  const arenaStatus = arena?.status ?? "idle";

  const canStartRound =
    !!arena && (arenaStatus === "idle" || arenaStatus === "ended");

  const canStopRound = arenaStatus === "active";
  const canGraceEnd = arenaStatus === "grace";

  const roundProgress = useMemo(() => {
    if (!arena) return 0;
    const now = Date.now();

    if (arena.status === "active") {
      const start = arena.roundStartTime;
      const end = arena.roundCutoff;
      return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
    }

    if (arena.status === "grace") {
      const start = arena.roundCutoff;
      const end = arena.graceEnd;
      return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
    }

    return 0;
  }, [arena]);

  const formatTime = (sec: number) => {
    if (!sec || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

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

  /* ============================================
     UI
  ============================================ */

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">

      {/* HEADER */}
      <header className="mb-6 relative">
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
                  Math.max(0, Math.floor((arena.roundCutoff - Date.now()) / 1000))
                )}

              {arena.status === "grace" &&
                formatTime(
                  Math.max(0, Math.floor((arena.graceEnd - Date.now()) / 1000))
                )}

              {arena.status === "ended" && "00:00"}
            </div>
          </div>
        )}
      </header>

      {/* ============================================================
          SPELBESTURING
      ============================================================ */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h2 className="text-sm font-semibold mb-3">Spelbesturing</h2>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => emitAdmin("startGame")}
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
            onClick={() => emitAdmin("stopGame")}
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

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => emitAdmin("startRound", { type: "quarter" })}
            disabled={!canStartRound}
            className="px-3 py-1.5 bg-[#ff4d4f] text-white rounded-full text-xs disabled:bg-gray-400"
          >
            Start voorronde
          </button>

          <button
            onClick={() => emitAdmin("startRound", { type: "finale" })}
            disabled={!canStartRound}
            className="px-3 py-1.5 bg-purple-600 text-white rounded-full text-xs disabled:bg-gray-400"
          >
            Start finale
          </button>

          <button
            onClick={() => emitAdmin("endRound")}
            disabled={!canStopRound}
            className="px-3 py-1.5 bg-gray-800 text-white rounded-full text-xs disabled:bg-gray-400"
          >
            Stop ronde
          </button>
        </div>
      </section>

      {/* ============================================================
          ARENA + QUEUE
      ============================================================ */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 relative">

        {/* Host Diamonds */}
        <div className="absolute md:left-1/2 md:-translate-x-1/2 md:translate-y-[-10px] right-2 top-[-6px] md:right-auto md:top-[-10px] z-20">
          <div className="bg-[#ff4d4f] text-white text-xs font-semibold px-3 py-1 rounded-full shadow-lg">
            Host: {fmt(hostDiamonds)} 💎
          </div>
        </div>

        {/* =====================
            ARENA CARD GRID
        ===================== */}
        <div className="bg-white rounded-2xl shadow p-4 relative overflow-hidden">

          {/* ★ REV WATERMARK */}
          {arena?.reverseMode && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10 select-none">
              <div className="text-[140px] font-black text-gray-700 tracking-widest rotate-[-20deg]">
                REV
              </div>
            </div>
          )}

          <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
            Arena

            {/* ★ REV BADGE */}
            {arena?.reverseMode && (
              <span className="px-2 py-0.5 rounded-full bg-purple-700 text-white text-[11px] shadow">
                REV
              </span>
            )}
          </h2>

          <p className="text-sm text-gray-500 mb-4">
            {arena
              ? `Ronde #${arena.round} • ${arena.type} • ${arena.status}`
              : "Geen ronde actief"}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 relative">
            {players.length ? (
              players.map((p, idx) => (
                <div
                  key={p.id}
                  className={`relative rounded-lg p-3 border text-sm shadow ${colorForPosition(
                    p
                  )}`}
                >
                  {/* DELETE BUTTON */}
                  <button
                    onClick={() => {
                      const formatted = p.username.startsWith("@")
                        ? p.username
                        : `@${p.username}`;

                      openConfirm({
                        message: `Weet je zeker dat je ${formatted} permanent uit de arena wilt verwijderen?`,
                        onConfirm: () => {
                          const socket = getAdminSocket();
                          setStatus(
                            `Bezig met removeFromArenaPermanent voor ${formatted}...`
                          );
                          socket.emit(
                            "removeFromArenaPermanent",
                            { username: formatted },
                            (res: AdminAckResponse) => {
                              setStatus(
                                res?.success
                                  ? "✅ Uitgevoerd"
                                  : `❌ ${res?.message ?? "Geen antwoord"}`
                              );
                              setConfirmData(null);
                            }
                          );
                        },
                      });
                    }}
                    className="absolute top-1 right-1 text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded shadow"
                  >
                    ✕
                  </button>

                  {/* POSITION */}
                  <div className="flex justify-between items-center">
                    <span className="font-bold">#{idx + 1}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-300 text-gray-700">
                      {p.positionStatus}
                    </span>
                  </div>

                  <div className="font-semibold truncate">
                    {p.display_name} (@{p.username})
                  </div>

                  {/* BADGES */}
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {p.boosters?.includes("mg") && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-200 text-pink-800 border border-pink-300">
                        MG
                      </span>
                    )}
                    {p.boosters?.includes("bomb") && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-200 text-red-800 border-red-300">
                        BOMB
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-gray-600 mt-1">
                    Score: {fmt(p.score)} 💎
                  </div>

                  {p.positionStatus === "elimination" && (
                    <button
                      onClick={() => {
                        const formatted = p.username.startsWith("@")
                          ? p.username
                          : `@${p.username}`;

                        openConfirm({
                          message: `Speler ${formatted} staat op elimination. Permanent verwijderen?`,
                          onConfirm: () => {
                            const socket = getAdminSocket();
                            setStatus(
                              `Bezig met removeFromArenaPermanent voor ${formatted}...`
                            );
                            socket.emit(
                              "removeFromArenaPermanent",
                              { username: formatted },
                              (res: AdminAckResponse) => {
                                setStatus(
                                  res?.success
                                    ? "✅ Uitgevoerd"
                                    : `❌ ${res?.message ?? "Geen antwoord"}`
                                );
                                setConfirmData(null);
                              }
                            );
                          },
                        });
                      }}
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

        {/* =====================
            QUEUE
        ===================== */}
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
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-700 border-blue-300">
                        Fan
                      </span>
                    )}
                    {q.priorityDelta > 0 && (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-purple-100 text-purple-700 border-purple-300">
                        Boost +{q.priorityDelta}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-xs text-gray-500">
                    #{q.position} • {q.reason}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-1 mt-2 sm:mt-0 justify-end sm:items-center">
                  <div className="flex gap-1 mr-1">
                    <button
                      onClick={() =>
                        emitAdmin("promoteUser", { username: q.username })
                      }
                      className="px-2 py-1 text-[11px] rounded-full bg-green-100 text-green-700 border border-green-300"
                    >
                      ↑ Promote
                    </button>

                    <button
                      onClick={() =>
                        emitAdmin("demoteUser", { username: q.username })
                      }
                      className="px-2 py-1 text-[11px] rounded-full bg-orange-100 text-orange-700 border-orange-300"
                    >
                      ↓ Demote
                    </button>
                  </div>

                  <button
                    onClick={() =>
                      emitAdmin("addToArena", { username: q.username })
                    }
                    className="px-2 py-1 rounded-full border border-[#ff4d4f] text-[#ff4d4f]"
                  >
                    → Arena
                  </button>

                  <button
                    onClick={() =>
                      emitAdmin("removeFromQueue", { username: q.username })
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

          {/* TABS */}
          <div className="w-full flex justify-end p-3 border-b border-gray-200 bg-gray-50">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveLbTab("players")}
                className={`
                  px-4 py-1.5 text-sm rounded-full border 
                  ${
                    activeLbTab === "players"
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
                  ${
                    activeLbTab === "gifters"
                      ? "bg-[#ff4d4f] text-white border-[#ff4d4f]"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                  }
                `}
              >
                Gifters
              </button>
            </div>
          </div>

          {/* PLAYERS LB */}
          {activeLbTab === "players" && (
            <div className="p-4 max-h-96 overflow-y-auto text-sm">
              <h2 className="text-xl font-semibold mb-2">Player Leaderboard</h2>
              <p className="text-xs text-gray-500 mb-3">
                Diamanten ontvangen in deze stream (total_score)
              </p>

              {playerLeaderboard.length ? (
                <>
                  {playerLeaderboard.map((e, idx) => (
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
                        {fmt(e.total_score)} 💎
                      </span>
                    </div>
                  ))}

                  <div className="text-right mt-3 font-bold text-gray-700">
                    Totaal:{" "}
                    {fmt(
                      playerLeaderboard.reduce(
                        (acc, p) => acc + (p.total_score || 0),
                        0
                      )
                    )} 💎
                  </div>
                </>
              ) : (
                <div className="text-sm text-gray-500 italic">
                  Geen spelers gevonden.
                </div>
              )}
            </div>
          )}

          {/* GIFTERS LB */}
          {activeLbTab === "gifters" && (
            <div className="p-4 max-h-96 overflow-y-auto text-sm">
              <h2 className="text-xl font-semibold mb-2">
                Gifter Leaderboard
              </h2>
              <p className="text-xs text-gray-500 mb-3">
                Diamanten verstuurd in deze stream
              </p>

              {gifterLeaderboard.length ? (
                <>
                  {gifterLeaderboard.map((e, idx) => (
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
                  ))}

                  <div className="text-right mt-3 font-bold text-gray-700">
                    Totaal:{" "}
                    {fmt(
                      gifterLeaderboard.reduce(
                        (acc, g) => acc + (g.total_diamonds || 0),
                        0
                      )
                    )} 💎
                  </div>
                </>
              ) : (
                <div className="text-sm text-gray-500 italic">
                  Geen gifters gevonden.
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ============================================================
          TWISTS PANEL
      ============================================================ */}
      <section className="mt-8 bg-white rounded-2xl shadow p-4">
        <h2 className="text-xl font-semibold mb-4">Twists</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* GIVE TWIST */}
          <div className="p-4 border rounded-xl bg-gray-50 shadow-sm relative">
            <h3 className="font-semibold mb-3">Twist geven aan speler</h3>

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

            {/* AUTOCOMPLETE */}
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
              <option value="diamondpistol">Diamond Pistol</option>
            </select>

            <button
              onClick={() =>
                emitAdmin("giveTwist", {
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
            <h3 className="font-semibold mb-3">Twist gebruiken (admin)</h3>

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

            {/* AUTOCOMPLETE */}
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
              <option value="diamondpistol">Diamond Pistol</option>
            </select>

            <label className="text-xs font-semibold">Target (optioneel)</label>
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

            {/* AUTOCOMPLETE TARGET */}
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
                emitAdmin("useTwist", {
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
        BattleBox Engine v3.3 – Danny Stable
      </footer>

      {/* ============================================================
          CONFIRM POPUP
      ============================================================ */}
      {confirmData && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80">
            <h3 className="text-lg font-semibold mb-3">Bevestigen</h3>
            <p className="text-sm mb-4">{confirmData.message}</p>

            <div className="flex justify-end gap-2">
              <button
                onClick={cancelConfirm}
                className="px-3 py-1.5 text-sm rounded-full bg-gray-200"
              >
                Annuleer
              </button>

              <button
                onClick={() => {
                  confirmData.onConfirm();
                }}
                className="px-3 py-1.5 text-sm rounded-full bg-red-600 text-white"
              >
                Bevestig
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
                  }
