// hooks/useArenaAndQueue.ts
"use client";

import { useEffect, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import { fetchArena, fetchQueue } from "@/lib/adminApi";
import type { ArenaState, QueueEntry, GlobalToggles } from "@/lib/adminTypes";

export function useArenaAndQueue() {
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [toggles, setToggles] = useState<GlobalToggles>({
    queueOpen: true,
    boostersEnabled: true,
    twistsEnabled: true,
    roundType: "voorronde",
    debugLogs: false,
    dayResetTime: "03:00",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initialLoad() {
      try {
        const [arenaData, queueData] = await Promise.all([
          fetchArena(),
          fetchQueue(),
        ]);
        if (!mounted) return;
        setArena(arenaData);
        setQueue(queueData);
      } catch (e: any) {
        if (!mounted) return;
        setError(e.message ?? "Kon arena/queue niet laden");
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
      setError("Geen live verbinding (Socket.io)");
    });

    socket.on("updateArena", (data: ArenaState) => {
      if (!mounted) return;
      setArena(data);
    });

    // ✔ FIXED — juiste payload-structuur
    socket.on(
      "updateQueue",
      (data: { open: boolean; entries: QueueEntry[] }) => {
        if (!mounted) return;
        setQueue(data.entries ?? []);
      }
    );

    return () => {
      mounted = false;
      socket.off("updateArena");
      socket.off("updateQueue");
    };
  }, []);

  return { arena, queue, toggles, setToggles, loading, error };
}
