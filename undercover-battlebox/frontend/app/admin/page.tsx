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
  const [queueOpen, setQueueOpen] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const socket = getAdminSocket();
    socket.on("updateArena", setArena);
    socket.on("updateQueue", (d) => {
      setQueue(d.entries ?? []);
      setQueueOpen(d.open ?? true);
    });
    socket.on("log", (l) => setLogs((p) => [l, ...p].slice(0, 200)));
    socket.on("initialLogs", (d) => setLogs(d.slice(0, 200)));
    return () => socket.removeAllListeners();
  }, []);

  const emitAdmin = (event: string, target?: string) => {
    const socket = getAdminSocket();
    const uname = target || username;
    if (!uname.trim()) return;
    const u = uname.startsWith("@") ? uname : `@${uname}`;
    setStatus(`Bezig met ${event}...`);
    socket.emit(event, { username: u }, (res: AdminAckResponse) =>
      setStatus(res.success ? "✅ Succesvol" : `❌ ${res.message}`)
    );
  };

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div className="text-2xl font-bold text-[#ff4d4f]">Undercover BattleBox</div>
        <span className="text-sm text-green-600 font-semibold">
          Admin verbonden
        </span>
      </header>

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
            className="w-full border rounded-lg px-3 py-2 text-sm"
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

      {status && (
        <div className="mb-4 text-sm text-center bg-amber-50 border border-amber-200 text-amber-800 rounded-xl py-2">
          {status}
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-1">Arena</h2>
          <p className="text-sm text-gray-500 mb-4">
            Ronde #{arena?.round ?? 0} • {arena?.type} • Max 8
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {arena?.players?.length
              ? arena.players.map((p, i) => (
                  <div
                    key={p.id}
                    className="rounded-lg p-3 border bg-gray-50 shadow-sm"
                  >
                    <div className="flex justify-between">
                      <span className="font-bold text-gray-700">#{i + 1}</span>
                      <span className="text-xs bg-red-50 text-gray-700 px-2 py-0.5 rounded-full">
                        {p.status}
                      </span>
                    </div>
                    <div className="font-semibold text-gray-900 truncate">
                      {p.display_name} (@{p.username.replace(/^@+/, "")})
                    </div>
                    <div className="text-xs text-gray-600">
                      {p.diamonds} 💎
                    </div>
                    {p.status === "alive" && (
                      <button
                        onClick={() => emitAdmin("admin:eliminate", p.username)}
                        className="mt-2 text-[11px] rounded-full border px-2 py-1 border-red-200 text-red-600 bg-red-50 hover:bg-red-100"
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

        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-1">Wachtrij</h2>
          <p className="text-sm text-gray-500 mb-3">
            {queue.length} speler(s) • Queue:{" "}
            <span className={queueOpen ? "text-green-600" : "text-red-600"}>
              {queueOpen ? "OPEN" : "DICHT"}
            </span>
          </p>

          {queue.length ? (
            queue.map((q) => (
              <div
                key={q.tiktok_id}
                className="rounded-lg border bg-gray-50 p-2 mb-2 text-sm flex justify-between"
              >
                <div>
                  <div className="font-semibold text-gray-900">
                    {q.display_name} (@{q.username.replace(/^@+/, "")})
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => emitAdmin("admin:addToArena", q.username)}
                    className="px-2 py-1 rounded-full border border-[#ff4d4f] text-[#ff4d4f]"
                  >
                    → Arena
                  </button>
                  <button
                    onClick={() => emitAdmin("admin:removeFromQueue", q.username)}
                    className="px-2 py-1 rounded-full border border-red-200 text-red-600 bg-red-50"
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

      <section className="mt-6 bg-white rounded-2xl shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Log Feed</h2>
        <div className="max-h-[400px] overflow-y-auto border rounded-lg text-sm">
          {logs.length ? (
            logs.map((log) => (
              <div
                key={log.id}
                className={`px-3 py-1 border-b ${
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
