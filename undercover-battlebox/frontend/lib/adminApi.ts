// lib/adminApi.ts
import type { ArenaState, QueueEntry, GlobalToggles } from "./adminTypes";

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN ?? "";

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
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

// REST fallback voor arena/queue
export function fetchArena(): Promise<ArenaState> {
  return apiFetch<ArenaState>("/arena");
}

export function fetchQueue(): Promise<QueueEntry[]> {
  return apiFetch<QueueEntry[]>("/queue");
}

// Admin actions (jij bouwt de backend endpoints morgen)
export function eliminatePlayer(tiktok_id: string) {
  return apiFetch<{ success: boolean }>("/api/admin/eliminate", {
    method: "POST",
    body: JSON.stringify({ tiktok_id }),
  });
}

export function startRound(type: "quarter" | "semi" | "finale") {
  return apiFetch<{ success: boolean }>("/api/admin/start-round", {
    method: "POST",
    body: JSON.stringify({ type }),
  });
}

export function toggleQueue(open: boolean) {
  return apiFetch<{ success: boolean; open: boolean }>("/api/admin/toggle-queue", {
    method: "POST",
    body: JSON.stringify({ open }),
  });
}

export function forceReset() {
  return apiFetch<{ success: boolean }>("/api/admin/force-reset", {
    method: "POST",
  });
}

export function setMultiplier(tiktok_id: string, multiplier: number) {
  return apiFetch<{ success: boolean }>("/api/admin/set-multiplier", {
    method: "POST",
    body: JSON.stringify({ tiktok_id, multiplier }),
  });
}

// User flags (queue/boosters/twists per user) – backend moet je zelf maken
export function updateUserFlags(payload: {
  tiktok_id: string;
  queue?: boolean;
  boosters?: boolean;
  twists?: boolean;
}) {
  return apiFetch<{ success: boolean }>("/api/admin/user-flags", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
