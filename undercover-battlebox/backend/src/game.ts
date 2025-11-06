// backend/src/game.ts
import type { Server } from "socket.io";
import type { WebcastPushConnection } from "tiktok-live-connector";

export interface Participant {
  id: string;
  display_name: string;
  username: string;
}

export class GameEngine {
  private io: Server;
  private connection: WebcastPushConnection;
  private participants = new Map<string, Participant>();

  constructor(io: Server, connection: WebcastPushConnection) {
    this.io = io;
    this.connection = connection;
    this.registerListeners();
    this.startUpdateLoop();
  }

  private registerListeners() {
    // Als iemand de arena betreedt of verlaat
    this.connection.on("member", (data: any) => {
      if (data.action === 1) this.onJoin(data);
      if (data.action === 2) this.onLeave(data);
    });

    // Bij reconnect of nieuwe connectie → haal huidige leden op
    this.connection.on("connected", async () => {
      console.log("[BB] Verbonden - initialiseer huidige arena-deelnemers…");
      try {
        const members = await this.connection.getRoomMembers();
        if (members && members.length > 0) {
          for (const m of members) {
            this.participants.set(String(m.userId), {
              id: String(m.userId),
              display_name: m.nickname || "Onbekend",
              username:
                m.uniqueId ||
                m.nickname.toLowerCase().replace(/[^a-z0-9_]/g, ""),
            });
          }
          console.log(`[BB] ${members.length} bestaande deelnemers hersteld.`);
        } else {
          console.log("[BB] Geen bestaande deelnemers gevonden.");
        }
      } catch (err) {
        console.error("[BB] Fout bij ophalen huidige leden:", err);
      }
      this.emitUpdate();
    });
  }

  private onJoin(data: any) {
    const id = String(data.userId || data.uniqueId || "0");
    const display_name = data.nickname || "Onbekend";
    const username =
      data.uniqueId ||
      display_name.toLowerCase().replace(/[^a-z0-9_]/g, "");

    if (!this.participants.has(id)) {
      this.participants.set(id, { id, display_name, username });
      console.log(`${display_name} [BB] komt de arena binnen.`);
      this.io.emit("arena:join", { id, display_name, username });
      this.emitUpdate();
    }
  }

  private onLeave(data: any) {
    const id = String(data.userId || data.uniqueId || "0");
    const display_name = data.nickname || "Onbekend";

    if (this.participants.delete(id)) {
      console.log(`${display_name} [BB] verlaat de arena.`);
      this.io.emit("arena:leave", { id, display_name });
      this.emitUpdate();
    }
  }

  private startUpdateLoop() {
    // Elke seconde push de huidige deelnemers
    setInterval(() => this.emitUpdate(), 1000);
  }

  private emitUpdate() {
    const list = Array.from(this.participants.values());
    this.io.emit("arena:update", list);
  }

  getActiveParticipants() {
    return Array.from(this.participants.values());
  }
}
