// lib/adminApi.ts — BattleBox v13.x (Gifts-Driven Edition)

import type { ArenaState, QueueEntry } from "./adminTypes";

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN ?? "";

// Basic headers for admin auth
function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ADMIN_TOKEN}`,
  };
}

// Fetch Arena snapshot (gift-driven)
export async function fetchArena(): Promise<ArenaState> {
  const r = await fetch(`${BASE_URL}/admin/arena`, {
    method: "GET",
    headers: headers(),
  });

  if (!r.ok) throw new Error("Arena kon niet geladen worden");
  return await r.json();
}

// Fetch Queue entries
export async function fetchQueue(): Promise<QueueEntry[]> {
  const r = await fetch(`${BASE_URL}/admin/queue`, {
    method: "GET",
    headers: headers(),
  });

  if (!r.ok) throw new Error("Queue kon niet geladen worden");
  const json = await r.json();

  // Backend returns: { open: boolean, entries: QueueEntry[] }
  return json.entries ?? [];
}

// Optional generic POST helper
export async function adminPost(path: string, body: any = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const msg = await r.text();
    throw new Error(`Fout bij POST ${path}: ${msg}`);
  }

  return await r.json().catch(() => ({}));
}
