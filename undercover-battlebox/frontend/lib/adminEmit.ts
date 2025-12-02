"use client";

import { getAdminSocket } from "@/lib/socketClient";
import type { AdminAckResponse } from "@/lib/adminTypes";

/**
 * Standaard emitter voor admin-events die een ACK teruggeven.
 * Panels gebruiken ALTIJD deze functie.
 */
export function emitAdmin(
  event: string,
  payload: any = {},
  setStatus?: (msg: string) => void
) {
  const socket = getAdminSocket();

  if (setStatus) setStatus(`Bezig met ${event}...`);

  socket.emit(event, payload, (res: AdminAckResponse) => {
    if (!setStatus) return;

    if (res?.success) setStatus("✅ Uitgevoerd");
    else setStatus(`❌ ${res?.message ?? "Onbekende fout"}`);
  });
}

/**
 * Voor events die username bevatten.
 */
export function emitAdminUser(
  event: string,
  username: string,
  setStatus?: (msg: string) => void
) {
  if (!username) return;

  const socket = getAdminSocket();
  const formatted = username.startsWith("@") ? username : `@${username}`;

  if (setStatus) setStatus(`Bezig met ${event}...`);

  socket.emit(event, { username: formatted }, (res: AdminAckResponse) => {
    if (!setStatus) return;

    if (res?.success) setStatus("✅ Uitgevoerd");
    else setStatus(`❌ ${res?.message ?? "Onbekende fout"}`);
  });
}

/**
 * Voor custom emit zonder ACK, wanneer UI geen feedback hoeft.
 */
export function emitSilent(event: string, payload: any = {}) {
  const socket = getAdminSocket();
  socket.emit(event, payload);
}
