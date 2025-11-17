// ============================================================================
// 9-admin-twist-engine.ts — v1.2 (Build-safe)
// ============================================================================
// Admin-paneel acties voor twist beheer:
//  - Geef twist
//  - Verwijder twist
//  - Toon huidige inventory
// ============================================================================

import { Socket } from "socket.io";
import { emitLog } from "../server";
import {
  giveTwistToUser,
  consumeTwistFromUser,
  listTwistsForUser,
  clearTwistsForUser,
} from "./twist-inventory";

import {
  TWIST_MAP,
  type TwistType,
  findTwistByAlias,
} from "./twist-definitions";

// ============================================================================
// EXPORT: initAdminTwistEngine
// (DIT MISSTE WAARDOOR DE BUILD FOUT GAF)
// ============================================================================
export function initAdminTwistEngine(socket: Socket) {
  // ---------------------------------------------------------
  // ADMIN: Give twist to user
  // ---------------------------------------------------------
  socket.on(
    "admin:twist:give",
    async ({ username, twist }: { username: string; twist: string }, ack: Function) => {
      try {
        const twistType = findTwistByAlias(twist);
        if (!twistType) {
          return ack({ success: false, message: "Onbekende twist" });
        }

        // Fetch user
        const db = await socket.fetchUser(username);
        if (!db) {
          return ack({ success: false, message: "Gebruiker niet gevonden" });
        }

        await giveTwistToUser(db.tiktok_id, twistType);

        emitLog({
          type: "twist",
          message: `ADMIN gaf twist ${twistType} aan ${db.display_name}`,
        });

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ---------------------------------------------------------
  // ADMIN: Remove one twist
  // ---------------------------------------------------------
  socket.on(
    "admin:twist:remove",
    async ({ username, twist }: { username: string; twist: string }, ack: Function) => {
      try {
        const twistType = findTwistByAlias(twist);
        if (!twistType) {
          return ack({ success: false, message: "Onbekende twist" });
        }

        const db = await socket.fetchUser(username);
        if (!db) {
          return ack({ success: false, message: "Gebruiker niet gevonden" });
        }

        const success = await consumeTwistFromUser(db.tiktok_id, twistType);
        if (!success) {
          return ack({ success: false, message: "Gebruiker heeft dit niet" });
        }

        emitLog({
          type: "twist",
          message: `ADMIN verwijderde twist ${twistType} van ${db.display_name}`,
        });

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ---------------------------------------------------------
  // ADMIN: List twists
  // ---------------------------------------------------------
  socket.on(
    "admin:twist:list",
    async ({ username }: { username: string }, ack: Function) => {
      try {
        const db = await socket.fetchUser(username);
        if (!db) {
          return ack({ success: false, message: "Gebruiker niet gevonden" });
        }

        const items = await listTwistsForUser(db.tiktok_id);

        ack({
          success: true,
          twists: items,
        });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ---------------------------------------------------------
  // ADMIN: Clear all twists
  // ---------------------------------------------------------
  socket.on(
    "admin:twist:clear",
    async ({ username }: { username: string }, ack: Function) => {
      try {
        const db = await socket.fetchUser(username);
        if (!db) {
          return ack({ success: false, message: "Gebruiker niet gevonden" });
        }

        await clearTwistsForUser(db.tiktok_id);

        emitLog({
          type: "twist",
          message: `ADMIN verwijderde alle twists van ${db.display_name}`,
        });

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );
}
