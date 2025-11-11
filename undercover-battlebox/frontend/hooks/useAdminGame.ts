"use client";

import { useEffect, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type {
  ArenaState,
  ArenaPlayer,
  QueueEntry,
  LogEntry,
  AdminAckResponse,
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
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState<boolean>(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastActionStatus, setLastActionStatus] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const socket = getAdminSocket();

    socket.on("updateArena", (data: ArenaState) => {
      if (!mounted) return;
      setArena(data);
    });

    socket.on("updateQueue", (data: { open: boolean; entries: QueueEntry[] }) => {
      if (!mounted) return;
      setQueue(data.entries ?? []);
      setQueueOpen(data.open ?? true);
    });

    socket.on("log", (log: LogEntry) => {
      if (!mounted) return;
      setLogs((prev) => [log, ...prev].slice(0, 200));
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connect error:", err);
      if (!mounted) return;
      setError("Geen live verbinding met backend (Socket.io)");
    });

    setLoading(false);

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

  async function emitAdminAction(event: string, username: string): Promise<void> {
    return new Promise((resolve) => {
      const socket = getAdminSocket();
      const normalized = normalizeUsername(username);
      setLastActionStatus(`Bezig: ${event} → ${normalized}...`);

      socket.emit(
        event,
        { username: normalized },
        (res: AdminAckResponse) => {
          if (!res) {
            setLastActionStatus(`Geen antwoord van server op ${event} (${normalized})`);
            return resolve();
          }
          if (!res.success) {
            setLastActionStatus(`Fout: ${res.message ?? "onbekende fout"} (${normalized})`);
          } else {
            setLastActionStatus(`OK: ${res.message ?? "Actie uitgevoerd"} (${normalized})`);
          }
          resolve();
        }
      );
    });
  }

  return {
    arena,
    queue,
    queueOpen,
    logs,
    loading,
    error,
    lastActionStatus,
    addToArena: (u: string) => emitAdminAction("admin:addToArena", u),
    addToQueue: (u: string) => emitAdminAction("admin:addToQueue", u),
    eliminate: (u: string) => emitAdminAction("admin:eliminate", u),
    promoteQueue: (u: string) => emitAdminAction("admin:promoteQueue", u),
    demoteQueue: (u: string) => emitAdminAction("admin:demoteQueue", u),
    removeFromQueue: (u: string) => emitAdminAction("admin:removeFromQueue", u),
    clearStatus: () => setLastActionStatus(null),
  };
}
