// backend/src/game.ts
import { Server } from "socket.io";
import type { WebcastPushConnection } from "tiktok-live-connector";

export interface ArenaParticipant {
  id: string;
  display_name: string;
  username: string;
}

export class GameEngine {
  private io: Server;
  private connection: WebcastPushConnection;
  private participants = new Map<string, ArenaParticipant>();

  constructor(io: Server, connection: WebcastPushConnection) {
    this.io = io;
    this.connection = connection;
    this.registerListeners();
  }

  private registerListeners() {
    // TikTok multi-guest updates (linkMic)
    this.connection.on("linkMicArmies", (data: any) => {
      try {
        const guests = this.parseGuests(data);
        this.syncParticipants(guests);
      } catch (err) {
        console.error("[BB] Fout bij verwerken linkMicArmies:", err);
      }
    });

    this.connection.on("connected", () => {
      console.log("[BB] GameEngine actief – wacht op multi-guest updates...");
    });
  }

  /** Haal gasten uit linkMicArmies payload */
  private parseGuests(data: any): ArenaParticipant[] {
    const armies = data?.armies || data?.participants || [];
    const guests: ArenaParticipant[] = [];

    for (const entry of armies) {
      const user = entry.user || entry;
      if (!user?.userId) continue;

      guests.push({
        id: String(user.userId),
        display_name: user.nickname || "Onbekend",
        username:
          user.uniqueId ||
          (user.nickname || "")
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, ""),
      });
    }

    return guests;
  }

  /** Synchroniseer huidige gasten met nieuwe lijst */
  private syncParticipants(newGuests: ArenaParticipant[]) {
    const newIds = new Set(newGuests.map((g) => g.id));
    const currentIds = new Set(this.participants.keys());

    // Nieuwe binnenkomers
    for (const g of newGuests) {
      if (!this.participants.has(g.id)) {
        this.participants.set(g.id, g);
        console.log(`${g.display_name} [BB] komt de arena binnen.`);
        this.io.emit("arena:join", g);
      }
    }

    // Weggegaan
    for (const oldId of currentIds) {
      if (!newIds.has(oldId)) {
        const old = this.participants.get(oldId);
        if (old) {
          console.log(`${old.display_name} [BB] verlaat de arena.`);
          this.io.emit("arena:leave", { id: old.id, display_name: old.display_name });
          this.participants.delete(oldId);
        }
      }
    }

    // Altijd de volledige lijst uitsturen voor dashboard
    this.emitArenaUpdate();
  }

  private emitArenaUpdate() {
    const list = Array.from(this.participants.values());
    this.io.emit("arena:update", list);
  }

  getActiveParticipants() {
    return Array.from(this.participants.values());
  }
}
