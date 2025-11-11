"use client";

import { useEffect, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type {
  AdminAckResponse,
  ArenaState,
  ArenaPlayer,
  QueueState,
  LogEntry,
} from "@/lib/adminTypes";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN ?? "";

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

export function useAdminGame() {
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastActionStatus, setLastActionStatus] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initialLoad() {
      try {
        const [arenaData, queueData, logsData] = await Promise.all([
          apiFetch<ArenaState>("/arena"),
          apiFetch<QueueState>("/queue"),
          apiFetch<LogEntry[]>("/logs?limit=100"),
        ]);
        if (!mounted) return;
        setArena(arenaData);
        setQueue(queueData);
        setLogs(logsData);
      } catch (e: any) {
        if (!mounted) return;
        setError(e.message ?? "Kon initiële data niet laden");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    initialLoad();

    const socket = getAdminSocket();

    socket.on("connect_error", (err) => {
      console.error("Socket connect error:", err);
      if (!mounted) return;
      setError("Geen live verbinding met backend (Socket.io)");
    });

    socket.on("updateArena", (data: ArenaState) => {
      if (!mounted) return;
      setArena(data);
    });

    socket.on("updateQueue", (data: QueueState) => {
      if (!mounted) return;
      setQueue(data);
    });

    socket.on("log", (log: LogEntry) => {
      if (!mounted) return;
      setLogs((prev) => {
        const arr = [log, ...prev];
        return arr.slice(0, 200); // max 200 logs
      });
    });

    return () => {
      mounted = false;
      socket.off("updateArena");
      socket.off("updateQueue");
      socket.off("log");
      socket.off("connect_error");
    };
  }, []);

  function normalizeUsername(username: string): string {
    const trimmed = username.trim();
    if (!trimmed) return trimmed;
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  }

  async function emitAdminAction(
    event: string,
    username: string
  ): Promise<void> {
    return new Promise((resolve) => {
      const socket = getAdminSocket();
      const normalized = normalizeUsername(username);
      setLastActionStatus(`Bezig: ${event} → ${normalized}...`);

      socket.emit(
        event,
        { username: normalized },
        (res: AdminAckResponse) => {
          if (!res) {
            setLastActionStatus(
              `Geen antwoord van server op ${event} (${normalized})`
            );
            return resolve();
          }
          if (!res.success) {
            setLastActionStatus(
              `Fout: ${res.message ?? "onbekende fout"} (${normalized})`
            );
          } else {
            setLastActionStatus(
              `OK: ${res.message ?? "Actie uitgevoerd"} (${normalized})`
            );
          }
          resolve();
        }
      );
    });
  }

  // Exposed acties
  async function addToArena(username: string) {
    await emitAdminAction("admin:addToArena", username);
  }

  async function addToQueue(username: string) {
    await emitAdminAction("admin:addToQueue", username);
  }

  async function eliminate(username: string) {
    await emitAdminAction("admin:eliminate", username);
  }

  async function promoteQueue(username: string) {
    await emitAdminAction("admin:promoteQueue", username);
  }

  async function demoteQueue(username: string) {
    await emitAdminAction("admin:demoteQueue", username);
  }

  async function removeFromQueue(username: string) {
    await emitAdminAction("admin:removeFromQueue", username);
  }

  function clearStatus() {
    setLastActionStatus(null);
  }

  return {
    arena,
    queue,
    logs,
    loading,
    error,
    lastActionStatus,
    clearStatus,
    addToArena,
    addToQueue,
    eliminate,
    promoteQueue,
    demoteQueue,
    removeFromQueue,
  };
}

export function sortArenaPlayers(players: ArenaPlayer[]): ArenaPlayer[] {
  return [...players].sort((a, b) => b.diamonds - a.diamonds);
}
