"use client";

import React from "react";
import Panel from "@/components/admin/ui/Panel";
import SectionHeader from "@/components/admin/ui/SectionHeader";

import type { LogEntry, LogType } from "@/lib/adminTypes";

interface LogsPanelProps {
  logs: LogEntry[];
}

export default function LogsPanel({ logs }: LogsPanelProps) {
  const typeColor = (type: LogType): string => {
    switch (type) {
      case "gift":
        return "text-pink-300";
      case "elim":
        return "text-red-300";
      case "join":
        return "text-green-300";
      case "twist":
        return "text-purple-300";
      default:
        return "text-slate-300";
    }
  };

  return (
    <Panel>
      <SectionHeader title="Log Feed" subtitle="Live events" />

      <div className="border border-[#2A3038] rounded-[4px] bg-[#13161C] max-h-[400px] overflow-y-auto relative">
        {/* Top fade */}
        <div className="pointer-events-none absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-[#1C2129] to-transparent z-10"></div>

        {logs?.length ? (
          logs.map((log) => (
            <div
              key={log.id}
              className="px-3 py-1.5 border-b border-[#2A3038] text-sm text-slate-300"
            >
              {/* TIMESTAMP */}
              <span className="font-mono text-xs text-slate-500 mr-2">
                {new Date(log.timestamp).toLocaleTimeString("nl-NL", {
                  hour12: false,
                })}
              </span>

              {/* TYPE */}
              <span className={`${typeColor(log.type)} font-semibold`}>
                {log.type.toUpperCase()}
              </span>

              {/* MESSAGE */}
              <span className="ml-2">{log.message}</span>
            </div>
          ))
        ) : (
          <div className="px-3 py-3 text-slate-500 italic">
            Nog geen logs ontvangen.
          </div>
        )}
      </div>
    </Panel>
  );
}
