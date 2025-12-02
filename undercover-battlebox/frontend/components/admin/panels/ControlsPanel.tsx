"use client";

import React from "react";
import Panel from "@/components/admin/ui/Panel";
import Button from "@/components/admin/ui/Button";
import SectionHeader from "@/components/admin/ui/SectionHeader";

export default function ControlsPanel({
  gameSession,
  arena,
  emitAdmin,
}) {
  const arenaStatus = arena?.status ?? "idle";

  const canStartRound =
    !!arena && (arenaStatus === "idle" || arenaStatus === "ended");

  const canStopRound = arenaStatus === "active";
  const canGraceEnd = arenaStatus === "grace";

  return (
    <Panel>
      <SectionHeader title="Spelbesturing" />

      <div className="flex flex-wrap gap-3 mb-4">
        {/* ===== GAME START/STOP ===== */}
        <Button
          variant={gameSession.active ? "disabled" : "success"}
          onClick={() => emitAdmin("startGame")}
          disabled={gameSession.active}
        >
          Start spel
        </Button>

        <Button
          variant={!gameSession.active ? "disabled" : "warning"}
          onClick={() => emitAdmin("stopGame")}
          disabled={!gameSession.active}
        >
          Stop spel
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* ===== ROUND CONTROLS ===== */}
        <Button
          variant={canStartRound ? "danger" : "disabled"}
          onClick={() => emitAdmin("startRound", { type: "quarter" })}
          disabled={!canStartRound}
        >
          Start voorronde
        </Button>

        <Button
          variant={canStartRound ? "purple" : "disabled"}
          onClick={() => emitAdmin("startRound", { type: "finale" })}
          disabled={!canStartRound}
        >
          Start finale
        </Button>

        <Button
          variant={canStopRound ? "dark" : "disabled"}
          onClick={() => emitAdmin("endRound")}
          disabled={!canStopRound}
        >
          Stop ronde
        </Button>
      </div>
    </Panel>
  );
}
