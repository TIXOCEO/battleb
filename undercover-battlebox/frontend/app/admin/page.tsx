"use client";

import React, { useEffect, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  AdminAckResponse,
} from "@/lib/adminTypes";

export default function AdminDashboardPage() {
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState<boolean>(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const socket = getAdminSocket();

    socket.on("updateArena", (data: ArenaState) => setArena(data));
    socket.on("updateQueue", (data: any) => {
      setQueue(data.entries ?? []);
      setQueueOpen(data.open ?? true);
    });
    socket.on("log", (data: LogEntry) =>
      setLogs((prev) => [data, ...prev].slice(0, 200))
    );

    return () => {
      socket.off("updateArena");
      socket.off("updateQueue");
      socket.off("log");
    };
  }, []);

  const emitAdmin = (event: string, target?: string) => {
    const socket = getAdminSocket();
    const uname = target || username;
    if (!uname.trim()) return;
    const u = uname.startsWith("@") ? uname : `@${uname}`;
    setStatus(`Bezig met ${event}...`);
    socket.emit(event, { username: u }, (res: AdminAckResponse) => {
      setStatus(res.success ? "✅ Succesvol uitgevoerd" : `❌ ${res.message}`);
    });
  };

  return (
    <main className="flex flex-col min-h-screen bg-gray-50 p-4 md:p-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div className="text-2xl font-bold text-[#ff4d4f]">UB</div>
          <h1 className="text-lg md:text-xl font-semibold">
            Undercover BattleBox – Admin
          </h1>
        </div>
        <div className="text-sm text-gray-600">
          <span className="font-semibold text-green-600">
            Connected as Admin
          </span>
        </div>
      </header>

      {/* Admin input / test acties */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-col md:flex-row gap-3 items-start md:items-end">
        <div className="flex-1">
          <label className="text-xs text-gray-600 font-semibold mb-1 block">
            @username toevoegen / verwijderen
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="@dangol__"
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
      </section>

      {/* Statusmelding */}
      {status && (
        <div className="mb-4 text-sm text-center bg-amber-50 border border-amber-200 text-amber-800 rounded-xl py-2">
          {status}
        </div>
      )}

      {/* Arena + Queue */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
        {/* Arena container */}
        <div className="bg-white rounded-2xl shadow p-4 md:p-6 overflow-y-auto">
          <h2 className="text-xl font-semibold mb-1 text-gray-900">
            Arena (huidige ronde)
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            {arena
              ? `Ronde #${arena.round} • ${arena.type}`
              : "Geen ronde actief"}{" "}
            • Max 8 deelnemers
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {arena?.players?.length ? (
              arena.players.map((p, i) => (
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
                    @{p.username}
                  </div>
                  <div className="text-xs text-gray-600">
                    Ronde: {p.diamonds} 💎
                  </div>
                  {p.status === "alive" && (
                    <button
                      onClick={() => emitAdmin("admin:eliminate", p.username)}
                      className="mt-2 px-2 py-1 text-[11px] rounded-full border border-red-200 text-red-600 bg-red-50 hover:bg-red-100"
                    >
                      Elimineer
                    </button>
                  )}
                </div>
              ))
            ) : (
              Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-gray-100 rounded-lg p-3 flex flex-col justify-center items-center text-sm text-gray-700"
                >
                  <span className="font-semibold text-gray-600">#{i + 1}</span>
                  <span className="text-gray-800 font-medium">
                    WACHT OP SPELER
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Queue container */}
        <div className="bg-white rounded-2xl shadow p-4 md:p-6 overflow-y-auto">
          <h2 className="text-xl font-semibold mb-1 text-gray-900">Wachtrij</h2>
          <p className="text-sm text-gray-500 mb-4">
            Live queue • promote / demote / direct naar arena
          </p>
          <div className="flex justify-between items-center mb-2 text-sm">
            <span className="text-gray-600">
              {queue.length} speler{queue.length !== 1 && "s"}
            </span>
            <span
              className={`font-semibold ${
                queueOpen ? "text-green-600" : "text-red-600"
              }`}
            >
              Queue: {queueOpen ? "OPEN" : "DICHT"}
            </span>
          </div>

          {queue.length ? (
            queue.map((q, idx) => (
              <div
                key={q.tiktok_id}
                className="rounded-lg border border-gray-200 bg-gray-50 p-2 mb-2 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-semibold text-gray-900">
                    #{idx + 1} @{q.username}{" "}
                    <span className="text-xs text-gray-500">
                      ({q.display_name})
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {q.reason}{" "}
                    {q.priorityDelta !== 0 && `(+${q.priorityDelta})`}
                  </div>
                </div>
                <div className="flex gap-1 mt-2 sm:mt-0 justify-end">
                  <button
                    onClick={() => emitAdmin("admin:promoteQueue", q.username)}
                    className="px-2 py-1 rounded-full border border-gray-200 bg-white hover:bg-gray-100"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => emitAdmin("admin:demoteQueue", q.username)}
                    className="px-2 py-1 rounded-full border border-gray-200 bg-white hover:bg-gray-100"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => emitAdmin("admin:addToArena", q.username)}
                    className="px-2 py-1 rounded-full border border-[#ff4d4f] text-[#ff4d4f] bg-white hover:bg-[#ff4d4f]/10"
                  >
                    → Arena
                  </button>
                  <button
                    onClick={() => emitAdmin("admin:removeFromQueue", q.username)}
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

      {/* Log Feed */}
      <section className="mt-6 bg-white rounded-2xl shadow p-4 md:p-6">
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
    </main>
  );
}
