"use client";

import React from "react";
import Panel from "@/components/admin/ui/Panel";
import SectionHeader from "@/components/admin/ui/SectionHeader";
import Badge from "@/components/admin/ui/Badge";
import Button from "@/components/admin/ui/Button";

export default function QueuePanel({
  queue,
  queueOpen,
  emitAdmin,
  fmt,
}: any) {
  return (
    <Panel>
      <SectionHeader title="Wachtrij" subtitle="Inkomende spelers" />

      <p className="text-sm text-slate-400 mb-3">
        {queue.length} speler{queue.length !== 1 && "s"} • Queue:{" "}
        <span
          className={
            queueOpen ? "text-green-400 font-semibold" : "text-red-400 font-semibold"
          }
        >
          {queueOpen ? "OPEN" : "DICHT"}
        </span>
      </p>

      {queue.length ? (
        queue.map((q: any) => (
          <div
            key={q.tiktok_id}
            className="rounded-[4px] border border-[#2A3038] bg-[#13161C] p-3 mb-3 text-sm shadow-sm"
          >
            <div className="font-semibold text-slate-200">
              {q.display_name} (@{q.username})
            </div>

            <div className="flex gap-1 mt-1 flex-wrap">
              {q.is_vip && <Badge color="yellow">VIP</Badge>}
              {q.is_fan && !q.is_vip && <Badge color="blue">Fan</Badge>}
              {q.priorityDelta > 0 && (
                <Badge color="purple">Boost +{q.priorityDelta}</Badge>
              )}
            </div>

            <div className="text-xs text-slate-500 mt-1">
              #{q.position} • {q.reason}
            </div>

            <div className="flex items-center gap-2 mt-3">
              <Button
                variant="success"
                className="text-xs"
                onClick={() =>
                  emitAdmin("promoteUser", { username: q.username })
                }
              >
                ↑ Promote
              </Button>

              <Button
                variant="warning"
                className="text-xs"
                onClick={() =>
                  emitAdmin("demoteUser", { username: q.username })
                }
              >
                ↓ Demote
              </Button>

              <Button
                variant="primary"
                className="text-xs"
                onClick={() =>
                  emitAdmin("addToArena", { username: q.username })
                }
              >
                → Arena
              </Button>

              <Button
                variant="danger"
                className="text-xs"
                onClick={() =>
                  emitAdmin("removeFromQueue", { username: q.username })
                }
              >
                ✕
              </Button>
            </div>
          </div>
        ))
      ) : (
        <div className="text-sm text-slate-500 italic">Wachtrij is leeg.</div>
      )}
    </Panel>
  );
}
