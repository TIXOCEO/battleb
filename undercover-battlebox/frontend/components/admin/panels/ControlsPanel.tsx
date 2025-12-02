import React from "react";
import Button from "../ui/Button";
import Panel from "../ui/Panel";
import type { EmitAdminFn } from "@/types/EmitAdminFn";

export default function ControlsPanel({
  gameSession,
  arena,
  emitAdmin,
}: {
  gameSession: { active: boolean; gameId: number | null };
  arena: any;
  emitAdmin: EmitAdminFn;
}) {
  const canStart = !gameSession.active;
  const canStop = gameSession.active;

  const canStartRound =
    arena && !arena.isRunning && arena.status === "idle";

  const canStopRound =
    arena && arena.isRunning && arena.status === "active";

  return (
    <Panel>
      <h2 className="text-lg font-bold mb-4">Game Controls</h2>

      <div className="flex gap-3 flex-wrap">

        {/* START GAME */}
        <Button
          variant={canStart ? "success" : "ghost"}
          disabled={!canStart}
          onClick={() => emitAdmin("startGame", {})}
        >
          Start Game
        </Button>

        {/* STOP GAME */}
        <Button
          variant={canStop ? "danger" : "ghost"}
          disabled={!canStop}
          onClick={() => emitAdmin("stopGame", {})}
        >
          Stop Game
        </Button>

        {/* START QUARTER ROUND */}
        <Button
          variant="primary"
          disabled={!canStartRound}
          onClick={() => emitAdmin("startRound", { type: "quarter" })}
        >
          Start Quarter Round
        </Button>

        {/* START FINALE */}
        <Button
          variant="warning"
          disabled={!canStartRound}
          onClick={() => emitAdmin("startRound", { type: "finale" })}
        >
          Start Finale
        </Button>

        {/* END ROUND */}
        <Button
          variant="danger"
          disabled={!canStopRound}
          onClick={() => emitAdmin("endRound", {})}
        >
          End Round
        </Button>
      </div>
    </Panel>
  );
}
