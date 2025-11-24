import { getAdminSocket } from "@/lib/socketClient";
import type { AdminAckResponse } from "@/lib/adminTypes";
import type { AdminEventName } from "@/lib/adminEvents";

export function adminEmit(
  event: AdminEventName,
  payload: any = {}
): Promise<AdminAckResponse> {
  return new Promise((resolve) => {
    const socket: any = getAdminSocket();

    socket.emit(event, payload, (res: AdminAckResponse) => {
      resolve(
        res || {
          success: false,
          message: "Geen antwoord van server",
        }
      );
    });
  });
}

export function adminEmitUser(
  event: AdminEventName,
  username: string
): Promise<AdminAckResponse> {
  const formatted = username.startsWith("@")
    ? username
    : `@${username}`;

  return adminEmit(event, { username: formatted });
}
