import { getAdminSocket } from "@/lib/socketClient";
import type { AdminAckResponse, AdminSocketOutbound } from "@/lib/adminTypes";

/**
 * Universele admin emitters
 * Gebruikt door panels die niet de hook willen importeren.
 */

export function emitAdmin<E extends keyof AdminSocketOutbound>(
  event: E,
  payload: Parameters<AdminSocketOutbound[E]>[0],
  setStatus?: (msg: string) => void
) {
  const socket = getAdminSocket();

  if (setStatus) setStatus(`Bezig met ${event}...`);

  // Overload fix voor socket.io
  (socket as any).emit(
    event,
    payload,
    (res: AdminAckResponse) => {
      if (!setStatus) return;

      if (res?.success) setStatus("✅ Uitgevoerd");
      else setStatus(`❌ ${res?.message ?? "Onbekende fout"}`);
    }
  );
}

export function emitAdminUser<E extends keyof AdminSocketOutbound>(
  event: E,
  username: string,
  setStatus?: (msg: string) => void
) {
  if (!username) return;

  const socket = getAdminSocket();
  const formatted = username.startsWith("@") ? username : `@${username}`;

  if (setStatus) setStatus(`Bezig met ${event}...`);

  (socket as any).emit(
    event,
    { username: formatted } as Parameters<AdminSocketOutbound[E]>[0],
    (res: AdminAckResponse) => {
      if (!setStatus) return;

      if (res?.success) setStatus("✅ Uitgevoerd");
      else setStatus(`❌ ${res?.message ?? "Onbekende fout"}`);
    }
  );
}
