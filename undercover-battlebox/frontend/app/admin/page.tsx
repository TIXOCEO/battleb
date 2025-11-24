"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  AdminAckResponse,
  PlayerLeaderboardEntry,
  GifterLeaderboardEntry,
  SearchUser,
} from "@/lib/adminTypes";
import type { AdminEventName } from "@/lib/adminEvents";

// ============================================================
// SAFE EMITTER HOOK
// ============================================================
function useAdminEmitters() {
  const socket: any = getAdminSocket();

  const emitAdmin = <E extends AdminEventName>(
    event: E,
    payload: any = {}
  ) =>
    new Promise<AdminAckResponse>((resolve) => {
      socket.emit(event, payload, (res: AdminAckResponse) => {
        resolve(res || { success: false, message: "Geen antwoord" });
      });
    });

  const emitAdminUser = <E extends AdminEventName>(
    event: E,
    username: string
  ) => {
    if (!username?.trim()) {
      return Promise.resolve({
        success: false,
        message: "Geen username opgegeven",
      });
    }

    const formatted =
      username.startsWith("@") ? username : `@${username}`;

    return emitAdmin(event, { username: formatted });
  };

  return { emitAdmin, emitAdminUser };
}

// ============================================================================
// COMPONENT
// ============================================================================
export default function AdminDashboardPage() {
  const { emitAdmin, emitAdminUser } = useAdminEmitters();

  // CORE STATE
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const [streamStats, setStreamStats] = useState<{
    totalPlayers: number;
    totalPlayerDiamonds: number;
    totalHostDiamonds: number;
  } | null>(null);

  const [playerLeaderboard, setPlayerLeaderboard] =
    useState<PlayerLeaderboardEntry[]>([]);

  const [gifterLeaderboard, setGifterLeaderboard] =
    useState<GifterLeaderboardEntry[]>([]);

  const [activeLbTab, setActiveLbTab] =
    useState<"players" | "gifters">("players");

  const [gameSession, setGameSession] = useState({
    active: false,
    gameId: null as number | null,
  });

  // USER INPUTS
  const [username, setUsername] = useState("");

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
    "main" | "give" | "use" | "target" | null
  >(null);

  // ============================================================
  // SOCKET LISTENERS
  // ============================================================
  useEffect(() => {
    const socket = getAdminSocket();

    socket.on("updateArena", setArena);
    socket.on("updateQueue", (d) => {
      setQueue(d.entries ?? []);
      setQueueOpen(d.open ?? true);
    });

    socket.on("log", (l) =>
      setLogs((prev) => [l, ...prev].slice(0, 200))
    );
    socket.on("initialLogs", (d) => setLogs(d.slice(0, 200)));

    socket.on("streamStats", setStreamStats);
    socket.on("gameSession", setGameSession);

    socket.on("leaderboardPlayers", setPlayerLeaderboard);
    socket.on("leaderboardGifters", setGifterLeaderboard);

    socket.on("connect_error", () =>
      setStatus("❌ Socket verbinding verbroken")
    );

    socket.on("round:start", (d) =>
      setStatus(`▶️ Ronde gestart (${d.type})`)
    );
    socket.on("round:grace", () =>
      setStatus(`⏳ Grace-periode actief`)
    );
    socket.on("round:end", () =>
      setStatus("⛔ Ronde beëindigd")
    );

    return () => {
      socket.off();
    };
  }, []);

  // ============================================================
  // INITIAL SNAPSHOT
  // ============================================================
  useEffect(() => {
    const socket = getAdminSocket();

    socket.emit("admin:getInitialSnapshot", {}, (snap: any) => {
      if (!snap) return;

      setArena(snap.arena ?? null);
      setQueue(snap.queue?.entries ?? []);
      setQueueOpen(snap.queue?.open ?? true);

      setLogs(snap.logs?.slice(0, 200) ?? []);
      setStreamStats(snap.stats ?? null);
      setGameSession(snap.gameSession ?? { active: false, gameId: null });

      if (snap.playerLeaderboard)
        setPlayerLeaderboard(snap.playerLeaderboard);
      if (snap.gifterLeaderboard)
        setGifterLeaderboard(snap.gifterLeaderboard);
    });
  }, []);

  // ============================================================
  // SEARCH
  // ============================================================
  useEffect(() => {
    if (!typing || typing.length < 2) {
      setSearchResults([]);
      return;
    }

    const s = getAdminSocket();
    const tm = setTimeout(() => {
      s.emit(
        "admin:searchUsers",
        { query: typing },
        (res: { users: SearchUser[] }) => {
          setSearchResults(res?.users || []);
        }
      );
    }, 150);

    return () => clearTimeout(tm);
  }, [typing]);

  // ============================================================
  // AUTOFILL APPLY
  // ============================================================
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
  // HELPERS
  // ============================================================
  const fmt = (n: number | undefined) =>
    Number(n ?? 0).toLocaleString("nl-NL");

  const players = useMemo(() => arena?.players ?? [], [arena]);
  const arenaStatus = arena?.status ?? "idle";
  const hasDoomed = players.some((p) => p.positionStatus === "elimination");

  const canStartRound =
    arena &&
    ["idle", "ended"].includes(arenaStatus) &&
    !hasDoomed;

  const canStopRound = arenaStatus === "active";
  const canGraceEnd = arenaStatus === "grace";

  const needsElimination =
    (arena?.settings?.forceEliminations ?? true) &&
    arenaStatus === "ended" &&
    hasDoomed;

  // ============================================================
  // ROUND PROGRESS
  // ============================================================
  const roundProgress = useMemo(() => {
    if (!arena) return 0;
    const now = Date.now();

    if (arena.status === "active") {
      return Math.min(
        100,
        Math.max(
          0,
          ((now - arena.roundStartTime) /
            (arena.roundCutoff - arena.roundStartTime)) *
            100
        )
      );
    }

    if (arena.status === "grace") {
      return Math.min(
        100,
        Math.max(
          0,
          ((now - arena.roundCutoff) /
            (arena.graceEnd - arena.roundCutoff)) *
            100
        )
      );
    }

    return 0;
  }, [arena]);

  const formatTime = (sec: number) => {
    if (sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
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
      {/* ============================================================
          HEADER
      ============================================================ */}
      <header className="mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold text-[#ff4d4f]">UB</div>

            <div>
              <div className="text-xl font-semibold">
                Undercover BattleBox – Admin
              </div>
              <div className="text-xs text-gray-500">
                Verbonden als <span className="font-semibold text-green-600">Admin</span>
              </div>
            </div>
          </div>

          <div className="text-xs px-3 py-1 rounded-full bg-gray-200 text-gray-800">
            {gameSession.active
              ? `Spel actief (#${gameSession.gameId})`
              : "Geen spel actief"}
          </div>
        </div>

        {/* TIMER BAR */}
        {arena && arena.status !== "idle" && (
          <div className="w-full bg-gray-300 rounded-full h-4 shadow-inner relative overflow-hidden">
            <div
              className={`
                h-4 transition-all duration-300
                ${
                  arena.status === "active"
                    ? "bg-[#ff4d4f]"
                    : arena.status === "grace"
                    ? "bg-yellow-400"
                    : arena.status === "ended"
                    ? "bg-gray-600"
                    : ""
                }
              `}
              style={{ width: `${roundProgress}%` }}
            />

            <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold">
              {arena.status === "active" &&
                formatTime(
                  Math.max(0, (arena.roundCutoff - Date.now()) / 1000)
                )}
              {arena.status === "grace" &&
                formatTime(
                  Math.max(0, (arena.graceEnd - Date.now()) / 1000)
                )}
              {arena.status === "ended" && "00:00"}
            </div>
          </div>
        )}
      </header>

      {/* ============================================================
          SPELBESTURING + ACTIES
      ============================================================ */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* GAME CONTROL */}
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold">Spelbesturing</div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={async () => {
                const res = await emitAdmin("admin:startGame");
                setStatus(res.success ? "✔ Game gestart" : `❌ ${res.message}`);
              }}
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
              onClick={async () => {
                const res = await emitAdmin("admin:stopGame");
                setStatus(res.success ? "✔ Game gestopt" : `❌ ${res.message}`);
              }}
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

          {/* ROUND ACTIONS */}
          <div>
            <div className="text-xs text-gray-600 mb-1">Ronde acties</div>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => emitAdmin("admin:startRound", { type: "quarter" })}
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
                className="px-3 py-1.5 bg-blue-600 text-white rounded-full text-xs disabled:bg-gray-400"
              >
                Start finale
              </button>

              <button
                onClick={() => emitAdmin("admin:endRound")}
                disabled={!canStopRound}
                className="px-3 py-1.5 bg-gray-700 text-white rounded-full text-xs disabled:bg-gray-400"
              >
                Stop ronde
              </button>

              <button
                onClick={() => emitAdmin("admin:endRound")}
                disabled={!canGraceEnd}
                className="px-3 py-1.5 bg-yellow-500 text-white rounded-full text-xs disabled:bg-gray-400"
              >
                Beëindig Grace
              </button>
            </div>
          </div>
        </div>

        {/* ARENA MENUBLOK START (sluit later in Deel 3 correct) */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          
          {/* ARENA SECTION */}
          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="text-xl font-semibold mb-2">Arena</h2>

            <p className="text-sm text-gray-500 mb-4">
              {arena
                ? `Ronde #${arena.round} • ${arena.type} • ${arena.status}`
                : "Geen ronde actief"}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {players.length > 0 ? (
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
                          emitAdminUser("admin:eliminate", p.username)
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

          {/* QUEUE SECTION */}
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

            {queue.length > 0 ? (
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

                  {/* ROW BUTTONS */}
                  <div className="flex gap-1 mt-2 sm:mt-0 justify-end">
                    <button
                      onClick={() =>
                        emitAdminUser("admin:promoteUser", q.username)
                      }
                      className="px-2 py-1 rounded-full bg-purple-50 border border-purple-300 text-purple-800 hover:bg-purple-100"
                    >
                      ▲
                    </button>

                    <button
                      onClick={() =>
                        emitAdminUser("admin:demoteUser", q.username)
                      }
                      className="px-2 py-1 rounded-full bg-purple-50 border border-purple-300 text-purple-800 hover:bg-purple-100"
                    >
                      ▼
                    </button>

                    <button
                      onClick={() =>
                        emitAdminUser("admin:addToArena", q.username)
                      }
                      className="px-2 py-1 rounded-full border border-[#ff4d4f] text-[#ff4d4f]"
                    >
                      → Arena
                    </button>

                    <button
                      onClick={() =>
                        emitAdminUser("admin:removeFromQueue", q.username)
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
        </div>
      </section>
      {/* ============================================================
          LEADERBOARDS
      ============================================================ */}
      <section className="mt-4">
        <div className="bg-white rounded-2xl shadow p-0 overflow-hidden">
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

          <div className="p-4 max-h-96 overflow-y-auto text-sm">
            {/* PLAYER LB */}
            {activeLbTab === "players" && (
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <h2 className="text-xl font-semibold mb-0.5">
                      Player Leaderboard
                    </h2>
                    <p className="text-xs text-gray-500">
                      Diamanten ontvangen (huidige stream)
                    </p>
                  </div>

                  {streamStats && (
                    <div className="text-right text-xs bg-gray-100 px-3 py-1 rounded-lg border border-gray-300 shadow-inner">
                      <div className="font-semibold text-gray-800">
                        Totaal Players:{" "}
                        <span className="text-[#ff4d4f]">
                          {fmt(streamStats.totalPlayerDiamonds)} 💎
                        </span>
                      </div>

                      <div className="font-semibold text-gray-800">
                        Totaal Host:{" "}
                        <span className="text-blue-700">
                          {fmt(streamStats.totalHostDiamonds)} 💎
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {playerLeaderboard.length > 0 ? (
                  playerLeaderboard.map((e, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between border-b border-gray-200 py-1 last:border-0"
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
                    Geen spelers gevonden.
                  </div>
                )}
              </div>
            )}

            {/* GIFTER LB */}
            {activeLbTab === "gifters" && (
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <h2 className="text-xl font-semibold mb-0.5">
                      Gifter Leaderboard
                    </h2>
                    <p className="text-xs text-gray-500">
                      Diamanten verstuurd (huidige stream)
                    </p>
                  </div>

                  {streamStats && (
                    <div className="text-right text-xs bg-gray-100 px-3 py-1 rounded-lg border border-gray-300 shadow-inner">
                      <div className="font-semibold text-gray-800">
                        Totaal Gifts:{" "}
                        <span className="text-[#ff4d4f]">
                          {fmt(
                            streamStats.totalPlayerDiamonds +
                              streamStats.totalHostDiamonds
                          )}{" "}
                          💎
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {gifterLeaderboard.length > 0 ? (
                  gifterLeaderboard.map((e, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between border-b border-gray-200 py-1 last:border-0"
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

            {/* AUTOCOMPLETE */}
            {showResults &&
              activeAutoField === "give" &&
              searchResults.length > 0 && (
                <div className="absolute left-0 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto z-20">
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

            {/* AUTOCOMPLETE */}
            {showResults &&
              activeAutoField === "use" &&
              searchResults.length > 0 && (
                <div className="absolute left-0 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto z-20">
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

            {/* AUTOCOMPLETE */}
            {showResults &&
              activeAutoField === "target" &&
              searchResults.length > 0 && (
                <div className="absolute left-0 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto z-20">
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
                  target: twistTargetUse || null,
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
          LOGS
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
