"use client";

import React from "react";
import Panel from "@/components/admin/ui/Panel";
import SectionHeader from "@/components/admin/ui/SectionHeader";
import Button from "@/components/admin/ui/Button";

export default function ControlsPanel({
  gameSession,
  arenaStatus,
  canStartRound,
  canStopRound,
  canGraceEnd,
  emitAdmin,
}: {
  gameSession: any;
  arenaStatus: string;
  canStartRound: boolean;
  canStopRound: boolean;
  canGraceEnd: boolean;
  emitAdmin: (event: string, payload?: any) => void;
}) {
  return (
    <Panel>
      <SectionHeader title="Spelbesturing" subtitle="Main controls" />

      {/* STATUS BADGE */}
      <div className="mb-4">
        {gameSession.active ? (
          <div className="text-sm text-green-400 font-semibold">
            Spel actief #{gameSession.gameId}
          </div>
        ) : (
          <div className="text-sm text-slate-400">Geen spel actief</div>
        )}
      </div>

      {/* GAME */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Button
          variant="success"
          disabled={gameSession.active}
          onClick={() => emitAdmin("startGame")}
        >
          ▶ Start spel
        </Button>

        <Button
          variant="warning"
          disabled={!gameSession.active}
          onClick={() => emitAdmin("stopGame")}
        >
          ⏹ Stop spel
        </Button>
      </div>

      {/* ROUNDS */}
      <SectionHeader title="Ronde acties" />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={!canStartRound}
          onClick={() => emitAdmin("startRound", { type: "quarter" })}
        >
          Start voorronde
        </Button>

        <Button
          variant="info"
          disabled={!canStartRound}
          onClick={() => emitAdmin("startRound", { type: "finale" })}
        >
          Start finale
        </Button>

        <Button
          variant="ghost"
          disabled={!canStopRound}
          onClick={() => emitAdmin("endRound")}
        >
          Stop ronde
        </Button>
      </div>
    </Panel>
  );
}
