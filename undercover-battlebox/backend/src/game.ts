// backend/src/game.ts
import { Server } from 'socket.io';
import type { WebcastPushConnection } from 'tiktok-live-connector';

export interface ArenaParticipant {
  id: string;
  display_name: string;
  username: string;
}

/**
 * GameEngine – op dit moment vooral verantwoordelijk voor:
 * - het bijhouden van multi-guest deelnemers ("arena")
 * - loggen wanneer iemand binnenkomt / vertrekt
 * - realtime updates naar dashboard/overlay via Socket.IO
 *
 * LET OP:
 * - We hangen nu aan het 'member' event van tiktok-live-connector.
 *   In jouw tests kun je checken of dit inderdaad de multi-guests zijn
 *   (anders kunnen we het eenvoudig aanpassen naar het juiste event/type).
 */
export class GameEngine {
  private io: Server;
  private connection: WebcastPushConnection;
  private participants = new Map<string, ArenaParticipant>();

  constructor(io: Server, connection: WebcastPushConnection) {
    this.io = io;
    this.connection = connection;

    this.registerArenaListeners();
  }

  private registerArenaListeners() {
    // Volgens tiktok-live-connector stuurt 'member' join/leave info.
    // data.action === 1 → join, data.action === 2 → leave (typische mapping).
    this.connection.on('member', (data: any) => {
      const action = data?.action;
      if (action === 1) {
        this.handleJoin(data);
      } else if (action === 2) {
        this.handleLeave(data);
      } else {
        // Onbekend actie-type, alleen debuggen – geen crash
        // console.log('[BB DEBUG] Onbekende member-action:', data);
      }
    });
  }

  private handleJoin(data: any) {
    const id = String(data.userId || data.uniqueId || '0');
    const display_name: string = data.nickname || 'Onbekend';
    const username: string =
      data.uniqueId ||
      (display_name || 'onbekend')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '');

    if (this.participants.has(id)) {
      // Al bekend, niets doen
      return;
    }

    const participant: ArenaParticipant = { id, display_name, username };
    this.participants.set(id, participant);

    // ✅ Gevraagde log: [BB] tag + tekst
    console.log(`${display_name} [BB] komt de arena binnen.`);

    // Realtime voor dashboard/overlay
    this.io.emit('arena:join', participant);
    this.emitArenaUpdate();
  }

  private handleLeave(data: any) {
    const id = String(data.userId || data.uniqueId || '0');
    const display_name: string = data.nickname || 'Onbekend';

    const existed = this.participants.delete(id);
    if (!existed) {
      return;
    }

    // ✅ Gevraagde log: [BB] tag + tekst
    console.log(`${display_name} [BB] verlaat de arena.`);

    this.io.emit('arena:leave', { id, display_name });
    this.emitArenaUpdate();
  }

  private emitArenaUpdate() {
    const list = Array.from(this.participants.values());
    this.io.emit('arena:update', list);
  }

  // Handig voor debug of later game-logica
  public getActiveParticipants(): ArenaParticipant[] {
    return Array.from(this.participants.values());
  }
}
