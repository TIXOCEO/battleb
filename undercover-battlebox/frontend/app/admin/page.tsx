"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import clsx from "clsx";

import {
  Panel,
  PanelHeader,
  PanelBody,
  PanelSectionTitle,
} from "@/components/admin/ui/Panel";

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

  /* ============================================
     UI LAYOUT START
============================================ */

  return (
    <main className="min-h-screen pb-20 pt-4 md:pt-6 px-3 md:px-6 text-slate-100">

      {/* ============================================
          HEADER + GAME STATUS
      ============================================ */}
      <header className="mb-6 relative">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
          <div className="flex items-center gap-3">
            <div className="text-3xl font-black text-[#ff4d4f] tracking-wider">
              UB
            </div>
            <div>
              <div className="text-xl font-semibold">Undercover BattleBox – Admin</div>
              <div className="text-xs text-slate-400">
                Verbonden als{" "}
                <span className="font-semibold text-emerald-400">Admin</span>
              </div>
            </div>
          </div>

          <div
            className={clsx(
              "text-xs px-4 py-1 rounded-full border shadow bg-[#0c0c11] backdrop-blur",
              gameSession.active
                ? "border-emerald-500/40 text-emerald-400"
                : "border-slate-600/50 text-slate-400"
            )}
          >
            {gameSession.active
              ? `Spel actief (#${gameSession.gameId})`
              : "Geen spel actief"}
          </div>
        </div>

        {/* ROUND PROGRESS BAR */}
        {arena && arena.status !== "idle" && (
          <div className="w-full h-3 rounded-full bg-slate-800 relative overflow-hidden border border-slate-700">
            <div
              className={clsx(
                "h-full transition-all duration-300 rounded-full shadow-[0_0_12px_currentColor]",
                arena.status === "active" && "bg-[#ff4d4f] text-[#ff4d4f]",
                arena.status === "grace" && "bg-yellow-400 text-yellow-400",
                arena.status === "ended" && "bg-slate-500 text-slate-500"
              )}
              style={{ width: `${roundProgress}%` }}
            />

            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-slate-200 tracking-wide">
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

      {/* ============================================
          CONTROL PANELS GRID
      ============================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ============================================
            PANEL: GAME CONTROLS
        ============================================ */}
        <Panel className="col-span-1">
          <PanelHeader>Spelbesturing</PanelHeader>
          <PanelBody>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => emitAdmin("startGame")}
                disabled={gameSession.active}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold shadow",
                  gameSession.active
                    ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                    : "bg-emerald-600 text-white"
                )}
              >
                Start spel
              </button>

              <button
                onClick={() => emitAdmin("stopGame")}
                disabled={!gameSession.active}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold shadow",
                  !gameSession.active
                    ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                    : "bg-yellow-600 text-white"
                )}
              >
                Stop spel
              </button>
            </div>

            <PanelSectionTitle>Ronde acties</PanelSectionTitle>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => emitAdmin("startRound", { type: "quarter" })}
                disabled={!canStartRound}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold shadow bg-[#ff4d4f] text-white disabled:bg-slate-700"
              >
                Start voorronde
              </button>

              <button
                onClick={() => emitAdmin("startRound", { type: "finale" })}
                disabled={!canStartRound}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-semibold shadow disabled:bg-slate-700"
              >
                Start finale
              </button>

              <button
                onClick={() => emitAdmin("endRound")}
                disabled={!canStopRound}
                className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-semibold shadow disabled:bg-slate-700"
              >
                Stop ronde
              </button>
            </div>
          </PanelBody>
        </Panel>

        {/* ============================================
            PANEL: PLAYER ACTIONS
        ============================================ */}
        <Panel className="col-span-1 lg:col-span-2">
          <PanelHeader>Speleracties</PanelHeader>
          <PanelBody>
            <div className="flex flex-col md:flex-row gap-3 md:items-end relative">
              <div className="flex-1" ref={autoRef}>
                <PanelSectionTitle>@username</PanelSectionTitle>
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
                  className="w-full border border-slate-700 bg-[#0a0a0f] px-3 py-2 text-sm rounded-lg text-slate-200 shadow"
                />

                {/* AUTOCOMPLETE */}
                {showResults &&
                  searchResults.length > 0 &&
                  activeAutoField === "main" && (
                    <div className="absolute left-0 mt-1 w-full bg-[#0c0c11] border border-slate-700 rounded-lg shadow-xl z-20 max-h-60 overflow-auto">
                      {searchResults.map((u) => (
                        <div
                          key={u.tiktok_id}
                          onClick={() => applyAutoFill(u)}
                          className="px-3 py-2 text-sm hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="font-semibold">{u.display_name}</span>{" "}
                          <span className="text-slate-400">@{u.username}</span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              <div className="flex gap-2 text-xs flex-wrap">
                <button
                  onClick={() => emitAdmin("addToArena", { username })}
                  className="px-3 py-1.5 bg-[#ff4d4f] text-white rounded-lg shadow"
                >
                  → Arena
                </button>

                <button
                  onClick={() => emitAdminWithUser("addToQueue", username)}
                  className="px-3 py-1.5 bg-slate-800 text-white rounded-lg shadow"
                >
                  → Queue
                </button>

                <button
                  onClick={() => emitAdmin("giveVip", { username })}
                  className="px-3 py-1.5 bg-yellow-400 text-black rounded-lg shadow border border-yellow-600"
                >
                  Geef VIP
                </button>

                <button
                  onClick={() => emitAdmin("removeVip", { username })}
                  className="px-3 py-1.5 bg-yellow-200 text-yellow-800 rounded-lg shadow border border-yellow-500"
                >
                  Verwijder VIP
                </button>
              </div>
            </div>
          </PanelBody>
        </Panel>
      </div>

      {/* ============================================
          ARENA & QUEUE GRID
      ============================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 relative">

        {/* HOST DIAMONDS */}
        <div className="absolute left-1/2 -translate-x-1/2 -top-5">
          <div className="bg-[#ff4d4f] text-white text-xs font-semibold px-4 py-1 rounded-full shadow-xl border border-red-500/40">
            Host: {fmt(hostDiamonds)} 💎
          </div>
        </div>

        {/* ============================================
            PANEL: ARENA
        ============================================ */}
        <Panel>
          <PanelHeader>Arena</PanelHeader>

          <PanelBody>
            <div className="text-sm text-slate-400 mb-4">
              {arena
                ? `Ronde #${arena.round} • ${arena.type} • ${arena.status}`
                : "Geen ronde actief"}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {players.length ? (
                players.map((p, idx) => {
                  const formatted = p.username.startsWith("@")
                    ? p.username
                    : `@${p.username}`;

                  const bg =
                    p.positionStatus === "immune"
                      ? "bg-emerald-900/20 border-emerald-500/40 text-emerald-300"
                      : p.positionStatus === "danger"
                      ? "bg-orange-900/20 border-orange-500/40 text-orange-300"
                      : p.positionStatus === "elimination"
                      ? "bg-red-900/20 border-red-500/40 text-red-300"
                      : "bg-slate-900/30 border-slate-700/40 text-slate-300";

                  return (
                    <div
                      key={p.id}
                      className={clsx(
                        "relative rounded-xl border p-3 shadow-lg",
                        bg
                      )}
                    >
                      {/* SMALL REMOVE BUTTON */}
                      <button
                        onClick={() =>
                          openConfirm({
                            message: `Weet je zeker dat je ${formatted} permanent wilt verwijderen?`,
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
                                      : `❌ ${res?.message}`
                                  );
                                  setConfirmData(null);
                                }
                              );
                            },
                          })
                        }
                        className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-red-700 text-white"
                      >
                        ✕
                      </button>

                      {/* POSITION */}
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-200">
                          #{idx + 1}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/20 border border-white/10">
                          {p.positionStatus}
                        </span>
                      </div>

                      {/* NAME */}
                      <div className="font-semibold mt-1 truncate text-slate-100">
                        {p.display_name} (@{p.username})
                      </div>

                      {/* BOOSTER BADGES */}
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {p.boosters?.includes("mg") && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-800/40 text-pink-200 border border-pink-400/30">
                            MG
                          </span>
                        )}
                        {p.boosters?.includes("bomb") && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-800/40 text-red-200 border border-red-400/30">
                            BOMB
                          </span>
                        )}
                      </div>

                      {/* SCORE */}
                      <div className="text-xs text-slate-400 mt-2">
                        Score: {fmt(p.score)} 💎
                      </div>

                      {/* ELIMINATION STATE */}
                      {p.positionStatus === "elimination" && (
                        <button
                          onClick={() =>
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
                                        : `❌ ${res?.message}`
                                    );
                                    setConfirmData(null);
                                  }
                                );
                              },
                            })
                          }
                          className="mt-3 w-full text-[10px] py-1 rounded bg-red-900/20 border border-red-500/40 text-red-300"
                        >
                          Verwijder speler
                        </button>
                      )}
                    </div>
                  );
                })
              ) : (
                Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 text-center text-slate-600 text-sm"
                  >
                    #{i + 1} — WACHT OP SPELER
                  </div>
                ))
              )}
            </div>
          </PanelBody>
        </Panel>

        {/* ============================================
            PANEL: QUEUE
        ============================================ */}
        <Panel>
          <PanelHeader>Wachtrij</PanelHeader>

          <PanelBody>
            <div className="text-sm text-slate-400 mb-3">
              {queue.length} speler{queue.length !== 1 && "s"} • Queue:{" "}
              <span
                className={
                  queueOpen
                    ? "text-emerald-400 font-semibold"
                    : "text-red-400 font-semibold"
                }
              >
                {queueOpen ? "OPEN" : "DICHT"}
              </span>
            </div>

            {queue.length ? (
              queue.map((q) => (
                <div
                  key={q.tiktok_id}
                  className="rounded-xl border border-slate-700 bg-[#0b0b11] p-3 mb-2 shadow-sm"
                >
                  <div className="font-semibold text-slate-200">
                    {q.display_name} (@{q.username})
                  </div>

                  <div className="flex flex-wrap gap-1 mt-2">
                    {q.is_vip && (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-yellow-900/20 text-yellow-300 border border-yellow-600/40">
                        VIP
                      </span>
                    )}
                    {q.is_fan && !q.is_vip && (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-blue-900/20 text-blue-300 border border-blue-600/40">
                        FAN
                      </span>
                    )}
                    {q.priorityDelta > 0 && (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-purple-900/20 text-purple-300 border border-purple-600/40">
                        Boost +{q.priorityDelta}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-xs text-slate-500">
                    #{q.position} • {q.reason}
                  </div>

                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      onClick={() =>
                        emitAdmin("promoteUser", { username: q.username })
                      }
                      className="px-2 py-1 text-[11px] rounded bg-emerald-900/20 text-emerald-300 border border-emerald-600/40"
                    >
                      ↑ Promote
                    </button>

                    <button
                      onClick={() =>
                        emitAdmin("demoteUser", { username: q.username })
                      }
                      className="px-2 py-1 text-[11px] rounded bg-orange-900/20 text-orange-300 border border-orange-600/40"
                    >
                      ↓ Demote
                    </button>

                    <button
                      onClick={() =>
                        emitAdmin("addToArena", { username: q.username })
                      }
                      className="px-2 py-1 text-[11px] rounded bg-[#ff4d4f]/20 text-[#ff4d4f] border border-[#ff4d4f]/50"
                    >
                      → Arena
                    </button>

                    <button
                      onClick={() =>
                        emitAdmin("removeFromQueue", { username: q.username })
                      }
                      className="px-2 py-1 text-[11px] rounded bg-red-900/20 text-red-300 border border-red-600/40"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-600 italic">
                Wachtrij is leeg.
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>

      {/* ============================================
          LEADERBOARDS
      ============================================ */}
      <Panel className="mt-6">
        <PanelHeader>Leaderboards</PanelHeader>

        {/* TABS */}
        <div className="flex justify-end mb-4 gap-2">
          <button
            onClick={() => setActiveLbTab("players")}
            className={clsx(
              "px-4 py-1.5 text-xs rounded-lg border shadow",
              activeLbTab === "players"
                ? "bg-[#ff4d4f] text-white border-[#ff4d4f]"
                : "bg-[#0c0c11] text-slate-300 border-slate-700 hover:bg-slate-800"
            )}
          >
            Players
          </button>

          <button
            onClick={() => setActiveLbTab("gifters")}
            className={clsx(
              "px-4 py-1.5 text-xs rounded-lg border shadow",
              activeLbTab === "gifters"
                ? "bg-[#ff4d4f] text-white border-[#ff4d4f]"
                : "bg-[#0c0c11] text-slate-300 border-slate-700 hover:bg-slate-800"
            )}
          >
            Gifters
          </button>
        </div>

        {/* PLAYERS LB */}
        {activeLbTab === "players" && (
          <div className="max-h-96 overflow-y-auto text-sm pr-2">
            {playerLeaderboard.length ? (
              <>
                {playerLeaderboard.map((e, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between border-b border-slate-700 py-2"
                  >
                    <div>
                      <span className="font-mono text-xs text-slate-500 mr-2">
                        #{idx + 1}
                      </span>
                      <span className="font-semibold text-slate-200">
                        {e.display_name} (@{e.username})
                      </span>
                    </div>

                    <span className="font-semibold text-slate-300">
                      {fmt(e.total_score)} 💎
                    </span>
                  </div>
                ))}

                <div className="text-right mt-3 font-bold text-slate-300">
                  Totaal:{" "}
                  {fmt(
                    playerLeaderboard.reduce(
                      (acc, p) => acc + (p.total_score || 0),
                      0
                    )
                  )}{" "}
                  💎
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500 italic">
                Geen spelers gevonden.
              </div>
            )}
          </div>
        )}

        {/* GIFTERS LB */}
        {activeLbTab === "gifters" && (
          <div className="max-h-96 overflow-y-auto text-sm pr-2">
            {gifterLeaderboard.length ? (
              <>
                {gifterLeaderboard.map((e, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between border-b border-slate-700 py-2"
                  >
                    <div>
                      <span className="font-mono text-xs text-slate-500 mr-2">
                        #{idx + 1}
                      </span>
                      <span className="font-semibold text-slate-200">
                        {e.display_name} (@{e.username})
                      </span>
                    </div>

                    <span className="font-semibold text-slate-300">
                      {fmt(e.total_diamonds)} 💎
                    </span>
                  </div>
                ))}

                <div className="text-right mt-3 font-bold text-slate-300">
                  Totaal:{" "}
                  {fmt(
                    gifterLeaderboard.reduce(
                      (acc, g) => acc + (g.total_diamonds || 0),
                      0
                    )
                  )}{" "}
                  💎
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500 italic">
                Geen gifters gevonden.
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* ============================================
          TWISTS PANEL
      ============================================ */}
      <Panel className="mt-6">
        <PanelHeader>Twists</PanelHeader>
        <PanelBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* GIVE TWIST */}
            <Panel className="border-slate-600/40 bg-[#0b0b11]">
              <PanelHeader>Twist geven</PanelHeader>

              <PanelBody>
                <label className="text-xs font-semibold text-slate-400">
                  @username
                </label>
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
                  className="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-[#0a0a0f] text-slate-200 shadow"
                />

                {/* AUTOCOMPLETE */}
                {showResults &&
                  searchResults.length > 0 &&
                  activeAutoField === "give" && (
                    <div className="absolute left-0 mt-1 w-full bg-[#0c0c11] border border-slate-700 rounded-lg shadow-xl z-20 max-h-60 overflow-auto">
                      {searchResults.map((u) => (
                        <div
                          key={u.tiktok_id}
                          onClick={() => applyAutoFill(u)}
                          className="px-3 py-2 text-sm hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="font-semibold">{u.display_name}</span>{" "}
                          <span className="text-slate-400">@{u.username}</span>
                        </div>
                      ))}
                    </div>
                  )}

                <label className="text-xs font-semibold text-slate-400 mt-3">
                  Twist
                </label>
                <select
                  value={twistTypeGive}
                  onChange={(e) => setTwistTypeGive(e.target.value)}
                  className="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-[#0a0a0f] text-slate-200"
                >
                  <option value="">-- Kies twist --</option>
                  <option value="galaxy">Galaxy</option>
                  <option value="moneygun">MoneyGun</option>
                  <option value="immune">Immune</option>
                  <option value="heal">Heal</option>
                  <option value="bomb">Bomb</option>
                  <option value="diamondpistol">DiamondPistol</option>
                  <option value="breaker">Breaker</option>
                </select>

                <button
                  onClick={() =>
                    emitAdmin("giveTwist", {
                      username: twistUserGive,
                      twist: twistTypeGive,
                    })
                  }
                  className="mt-3 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm w-full shadow"
                >
                  Geef twist
                </button>
              </PanelBody>
            </Panel>

            {/* USE TWIST */}
            <Panel className="border-slate-600/40 bg-[#0b0b11]">
              <PanelHeader>Twist gebruiken (admin)</PanelHeader>

              <PanelBody>
                <label className="text-xs font-semibold text-slate-400">
                  Gebruiker
                </label>
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
                  className="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-[#0a0a0f] text-slate-200 shadow"
                />

                {/* AUTOCOMPLETE */}
                {showResults &&
                  searchResults.length > 0 &&
                  activeAutoField === "use" && (
                    <div className="absolute left-0 mt-1 w-full bg-[#0c0c11] border border-slate-700 rounded-lg shadow-xl z-20 max-h-60 overflow-auto">
                      {searchResults.map((u) => (
                        <div
                          key={u.tiktok_id}
                          onClick={() => applyAutoFill(u)}
                          className="px-3 py-2 text-sm hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="font-semibold">{u.display_name}</span>{" "}
                          <span className="text-slate-400">@{u.username}</span>
                        </div>
                      ))}
                    </div>
                  )}

                <label className="text-xs font-semibold text-slate-400 mt-3">
                  Twist
                </label>
                <select
                  value={twistTypeUse}
                  onChange={(e) => setTwistTypeUse(e.target.value)}
                  className="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-[#0a0a0f] text-slate-200"
                >
                  <option value="">-- Kies twist --</option>
                  <option value="galaxy">Galaxy</option>
                  <option value="moneygun">MoneyGun</option>
                  <option value="immune">Immune</option>
                  <option value="heal">Heal</option>
                  <option value="bomb">Bomb</option>
                  <option value="diamondpistol">DiamondPistol</option>
                  <option value="breaker">Breaker</option>
                </select>

                <label className="text-xs font-semibold text-slate-400 mt-3">
                  Target (optioneel)
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
                  className="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-[#0a0a0f] text-slate-200 mb-3 shadow"
                />

                {/* AUTOCOMPLETE */}
                {showResults &&
                  searchResults.length > 0 &&
                  activeAutoField === "target" && (
                    <div className="absolute left-0 mt-1 w-full bg-[#0c0c11] border border-slate-700 rounded-lg shadow-xl z-20 max-h-60 overflow-auto">
                      {searchResults.map((u) => (
                        <div
                          key={u.tiktok_id}
                          onClick={() => applyAutoFill(u)}
                          className="px-3 py-2 text-sm hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="font-semibold">{u.display_name}</span>{" "}
                          <span className="text-slate-400">@{u.username}</span>
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
                  className="mt-3 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm w-full shadow"
                >
                  Gebruik twist
                </button>
              </PanelBody>
            </Panel>
          </div>
        </PanelBody>
      </Panel>

      {/* ============================================
          PANEL: LOG FEED
      ============================================ */}
      <Panel className="mt-6">
        <PanelHeader>Log feed</PanelHeader>

        <PanelBody>
          <div className="max-h-[400px] overflow-y-auto border border-slate-700/40 rounded-lg bg-[#0b0b11] text-sm">
            {logs.length ? (
              logs.map((log) => {
                const color =
                  log.type === "gift"
                    ? "bg-pink-900/20 text-pink-300 border-pink-700/30"
                    : log.type === "elim"
                    ? "bg-red-900/20 text-red-300 border-red-700/30"
                    : log.type === "join"
                    ? "bg-emerald-900/20 text-emerald-300 border-emerald-700/30"
                    : log.type === "twist"
                    ? "bg-purple-900/20 text-purple-300 border-purple-700/30"
                    : "bg-blue-900/20 text-blue-300 border-blue-700/30";

                return (
                  <div
                    key={log.id}
                    className={`px-3 py-2 border-b border-slate-700/40 ${color}`}
                  >
                    <span className="font-mono text-xs opacity-70 mr-2">
                      {new Date(log.timestamp).toLocaleTimeString("nl-NL", {
                        hour12: false,
                      })}
                    </span>
                    <strong>{log.type.toUpperCase()}</strong> – {log.message}
                  </div>
                );
              })
            ) : (
              <div className="px-3 py-2 text-slate-500 italic">
                Nog geen logs ontvangen.
              </div>
            )}
          </div>
        </PanelBody>
      </Panel>

      <footer className="mt-6 text-xs text-slate-600 text-center pb-6">
        BattleBox Engine v3.3 — Danny Stable Build
      </footer>

      {/* ============================================
          CONFIRM POPUP
      ============================================ */}
      {confirmData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-80 rounded-2xl border border-slate-700 bg-[#050509] p-6 shadow-2xl">
            <h3 className="mb-3 text-lg font-semibold text-slate-100">
              Bevestigen
            </h3>
            <p className="mb-5 text-sm text-slate-300">
              {confirmData.message}
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={cancelConfirm}
                className="px-3 py-1.5 text-sm rounded-lg bg-slate-800 text-slate-200 border border-slate-600 hover:bg-slate-700 transition"
              >
                Annuleer
              </button>

              <button
                onClick={() => {
                  confirmData.onConfirm();
                }}
                className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white border border-red-500 hover:bg-red-500 transition shadow-[0_0_12px_rgba(248,113,113,0.5)]"
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
