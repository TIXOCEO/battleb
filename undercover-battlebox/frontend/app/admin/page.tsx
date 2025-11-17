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

// For autocomplete
type SearchUser = {
  tiktok_id: string;
  username: string;
  display_name: string;
};

export default function AdminDashboardPage() {
  // CORE STATES
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [gameSession, setGameSession] = useState<GameSessionState>({
    active: false,
    gameId: null,
  });

  // INPUT STATES
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  // TWISTS
  const [twistUser, setTwistUser] = useState("");
  const [twistType, setTwistType] = useState("");
  const [twistTarget, setTwistTarget] = useState("");

  // AUTOCOMPLETE RESULTS
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [typing, setTyping] = useState("");

  // ============================================================
  // SOCKET SETUP
  // ============================================================
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
    socket.on("initialLogs", (d: LogEntry[]) => setLogs(d.slice(0, 200)));
    socket.on("streamStats", (s: StreamStats) => setStreamStats(s));
    socket.on("streamLeaderboard", (e: LeaderboardEntry[]) =>
      setLeaderboard(e)
    );
    socket.on("gameSession", (s: GameSessionState) => setGameSession(s));

    socket.on("connect_error", () =>
      setStatus("❌ Socket verbinding weggevallen")
    );

    socket.on("round:start", (d: any) =>
      setStatus(`▶️ Ronde gestart (${d.type}) — ${d.duration}s`)
    );

    socket.on("round:grace", (d: any) =>
      setStatus(`⏳ Grace-periode actief (${d.grace}s)`)
    );

    socket.on("round:end", () => setStatus("⛔ Ronde beëindigd"));

    return () => {
      socket.off("updateArena");
      socket.off("updateQueue");
      socket.off("log");
      socket.off("initialLogs");
      socket.off("streamStats");
      socket.off("streamLeaderboard");
      socket.off("gameSession");
      socket.off("connect_error");
      socket.off("round:start");
      socket.off("round:grace");
      socket.off("round:end");
    };
  }, []);

  // ============================================================
  // FETCH INITIAL SNAPSHOT
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
      if (snap.leaderboard) setLeaderboard(snap.leaderboard);
    });
  }, []);

  // ============================================================
  // ADMIN EMITTERS
  // ============================================================
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

    const formatted = uname.startsWith("@") ? uname : `@${uname}`;
    setStatus(`Bezig met ${event}...`);

    socket.emit(event, { username: formatted }, (res: AdminAckResponse) =>
      setStatus(res.success ? "✅ Uitgevoerd" : `❌ ${res.message}`)
    );
  };

  const fmt = (n: number) =>
    n.toLocaleString("nl-NL", { maximumFractionDigits: 0 });

  const players = useMemo(() => arena?.players ?? [], [arena]);

  const colorForPosition = (p: any) => {
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
  // AUTOCOMPLETE — search via socket first, then HTTP fallback
  // ============================================================
  useEffect(() => {
    if (!typing.trim() || typing.length < 2) {
      setSearchResults([]);
      return;
    }

    const run = async () => {
      const socket = getAdminSocket();

      socket.emit(
        "admin:searchUsers",
        { query: typing },
        async (res: { users: SearchUser[] }) => {
          if (res.users?.length) {
            setSearchResults(res.users);
            return;
          }

          // fallback HTTP
          const http = await fetch(
            `/admin/searchUsers?query=${encodeURIComponent(typing)}`
          );
          const json = await http.json();
          setSearchResults(json.users || []);
        }
      );
    };

    const timer = setTimeout(run, 150);
    return () => clearTimeout(timer);
  }, [typing]);

  const applyAutoFill = (u: SearchUser) => {
    setUsername(u.username);
    setTwistUser(u.username);
    setTwistTarget(u.username);
    setTyping("");
    setSearchResults([]);
    setShowResults(false);
  };

  // ============================================================
  // RENDER UI
  // ============================================================
  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-6">
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
      </header>

      {/* SPELBESTURING */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
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
        </div>

        {/* SPELERSACTIES */}
        <div className="lg:col-span-2 flex flex-col gap-3">
          <div className="text-sm font-semibold">Speleracties</div>

          <div className="flex flex-col md:flex-row gap-3 md:items-end relative">
            <div className="flex-1">
              <label className="text-xs text-gray-600 font-semibold mb-1 block">
                @username (zoek)
              </label>
              <input
                type="text"
                value={typing}
                onChange={(e) => {
                  setTyping(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="@zoeken"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />

              {showResults && searchResults.length > 0 && (
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

            <div className="flex gap-2 text-xs">
              <button
                onClick={() => emitAdminWithUser("admin:addToArena", username)}
                className="px-3 py-1.5 bg-[#ff4d4f] text-white rounded-full"
              >
                → Arena
              </button>

              <button
                onClick={() => emitAdminWithUser("admin:addToQueue", username)}
                className="px-3 py-1.5 bg-gray-800 text-white rounded-full"
              >
                → Queue
              </button>

              <button
                onClick={() => emitAdminWithUser("admin:eliminate", username)}
                className="px-3 py-1.5 bg-red-600 text-white rounded-full"
              >
                Elimineer
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* STATUS */}
      {status && (
        <div className="mb-4 text-sm text-center bg-amber-50 border border-amber-200 text-amber-800 rounded-xl py-2">
          {status}
        </div>
      )}

      {/* ============================================================
          ARENA + QUEUE WEERGAVE
      ============================================================ */}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ARENA */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-2">Arena</h2>
          <p className="text-sm text-gray-500 mb-4">
            {arena ? `Ronde #${arena.round} • ${arena.type}` : "Geen ronde actief"}
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

        {/* WACHTRIJ */}
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
            queue.map((q) => {
              const badges: JSX.Element[] = [];

              if (q.is_vip) {
                badges.push(
                  <span
                    key="vip"
                    className="px-2 py-0.5 text-[10px] rounded-full bg-yellow-200 text-yellow-900 border border-yellow-400"
                  >
                    VIP
                  </span>
                );
              }

              if (q.is_fan && !q.is_vip) {
                badges.push(
                  <span
                    key="fan"
                    className="px-2 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-700 border border-blue-300"
                  >
                    Fan
                  </span>
                );
              }

              if (q.priorityDelta > 0) {
                badges.push(
                  <span
                    key="boost"
                    className="px-2 py-0.5 text-[10px] rounded-full bg-purple-100 text-purple-700 border border-purple-300"
                  >
                    Boost +{q.priorityDelta}
                  </span>
                );
              }

              return (
                <div
                  key={q.tiktok_id}
                  className="rounded-lg border border-gray-200 bg-gray-50 p-2 mb-2 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-semibold text-gray-900">
                      {q.display_name} (@{q.username})
                    </div>

                    <div className="flex flex-wrap gap-1 mt-1">{badges}</div>

                    <div className="mt-1 text-xs text-gray-500">
                      #{q.position} • {q.reason}
                    </div>
                  </div>

                  <div className="flex gap-1 mt-2 sm:mt-0 justify-end">
                    <button
                      onClick={() =>
                        emitAdmin("admin:boostUser", { username: q.username })
                      }
                      className="px-2 py-1 rounded-full bg-purple-50 border border-purple-300 text-purple-800 hover:bg-purple-100"
                    >
                      ▲
                    </button>

                    <button
                      onClick={() =>
                        emitAdmin("admin:demoteUser", { username: q.username })
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
              );
            })
          ) : (
            <div className="text-sm text-gray-500 italic">
              Wachtrij is leeg.
            </div>
          )}
        </div>
      </section>

      {/* LEADERBOARD & STATS */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* LEADERBOARD */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-2">Leaderboard</h2>
          <p className="text-xs text-gray-500 mb-3">Per spel – spelers</p>

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
              <div className="text-sm text-gray-500 italic">Geen data beschikbaar.</div>
            )}
          </div>
        </div>

        {/* STATS */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-2">Stream stats</h2>
          <p className="text-xs text-gray-500 mb-3">
            Gebaseerd op huidige actieve game-sessie
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
      <section className="mt-8 bg-white rounded-2xl shadow p-4">
        <h2 className="text-xl font-semibold mb-4">Twists</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* GIVE TWIST */}
          <div className="p-4 border rounded-xl bg-gray-50 shadow-sm">
            <h3 className="font-semibold mb-3">Twist geven aan speler</h3>

            <label className="text-xs font-semibold">@username</label>
            <input
              type="text"
              value={twistUser}
              onChange={(e) => setTwistUser(e.target.value)}
              placeholder="@gebruiker"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
            />

            <label className="text-xs font-semibold">Kies twist</label>
            <select
              value={twistType}
              onChange={(e) => setTwistType(e.target.value)}
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
                  username: twistUser,
                  twist: twistType,
                })
              }
              className="mt-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm w-full"
            >
              Geef twist
            </button>
          </div>

          {/* USE TWIST */}
          <div className="p-4 border rounded-xl bg-gray-50 shadow-sm">
            <h3 className="font-semibold mb-3">Twist gebruiken (admin)</h3>

            <label className="text-xs font-semibold">Gebruiker</label>
            <input
              type="text"
              value={twistUser}
              onChange={(e) => setTwistUser(e.target.value)}
              placeholder="@gebruiker"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
            />

            <label className="text-xs font-semibold">Twist</label>
            <select
              value={twistType}
              onChange={(e) => setTwistType(e.target.value)}
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
              Target gebruiker (indien nodig)
            </label>
            <input
              type="text"
              value={twistTarget}
              onChange={(e) => setTwistTarget(e.target.value)}
              placeholder="@target"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
            />

            <button
              onClick={() =>
                emitAdmin("admin:useTwist", {
                  username: twistUser,
                  twist: twistType,
                  target: twistTarget,
                })
              }
              className="mt-2 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm w-full"
            >
              Gebruik twist
            </button>
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

      <footer className="mt-4 text-xs text-gray-400 text-center">
        BattleBox Engine v3.1 Danny Stable
      </footer>
    </main>
  );
}
