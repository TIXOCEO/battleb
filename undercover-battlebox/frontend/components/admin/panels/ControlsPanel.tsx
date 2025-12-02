"use client";

import React from "react";
import Panel from "@/components/admin/ui/Panel";
import Button from "@/components/admin/ui/Button";
import SectionHeader from "@/components/admin/ui/SectionHeader";

import type { ArenaState } from "@/lib/adminTypes";

export interface GameSessionState {
  active: boolean;
  gameId: number | null;
}

interface ControlsPanelProps {
  gameSession: GameSessionState;
  arena: ArenaState | null;
  emitAdmin: (event: string, payload?: any) => void;
}

export default function ControlsPanel({
  gameSession,
  arena,
  emitAdmin,
}: ControlsPanelProps) {
  const arenaStatus = arena?.status ?? "idle";

  const canStartRound =
    !!arena && (arenaStatus === "idle" || arenaStatus === "ended");

  const canStopRound = arenaStatus === "active";

  return (
    <Panel>
      <SectionHeader title="Spelbesturing" />

      <div className="flex flex-wrap gap-3 mb-4">
        {/* ===== START GAME ===== */}
        <Button
          variant="success"
          disabled={gameSession.active}
          onClick={() => emitAdmin("startGame")}
        >
          Start spel
        </Button>

        {/* ===== STOP GAME ===== */}
        <Button
          variant="warning"
          disabled={!gameSession.active}
          onClick={() => emitAdmin("stopGame")}
        >
          Stop spel
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* ===== ROUND: VOORRONDE ===== */}
        <Button
          variant="danger"
          disabled={!canStartRound}
          onClick={() => emitAdmin("startRound", { type: "quarter" })}
        >
          Start voorronde
        </Button>

        {/* ===== ROUND: FINALE ===== */}
        <Button
          variant="purple"
          disabled={!canStartRound}
          onClick={() => emitAdmin("startRound", { type: "finale" })}
        >
          Start finale
        </Button>

        {/* ===== STOP ROUND ===== */}
        <Button
          variant="dark"
          disabled={!canStopRound}
          onClick={() => emitAdmin("endRound")}
        >
          Stop ronde
        </Button>
      </div>
    </Panel>
  );
}
