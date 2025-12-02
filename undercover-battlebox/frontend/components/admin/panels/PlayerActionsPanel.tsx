"use client";

import React from "react";
import Panel from "@/components/admin/ui/Panel";
import SectionHeader from "@/components/admin/ui/SectionHeader";
import Input from "@/components/admin/ui/Input";
import Label from "@/components/admin/ui/Label";
import Button from "@/components/admin/ui/Button";

import type { EmitAdminFn, EmitAdminUserFn } from "@/types/EmitAdminFn";
import type { SearchUser } from "@/lib/adminTypes";

export interface PlayerActionsPanelProps {
  username: string;
  setUsername: (v: string) => void;

  emitAdmin: EmitAdminFn;
  emitAdminUser: EmitAdminUserFn;

  autocomplete: {
    searchResults: SearchUser[];
    showResults: boolean;
    activeAutoField: string | null;
    applyAutoFill: (u: SearchUser) => void;
    onAutoFocus: (field: string, value: string) => void;
  };
}

export default function PlayerActionsPanel({
  username,
  setUsername,
  emitAdmin,
  emitAdminUser,
  autocomplete,
}: PlayerActionsPanelProps) {
  const {
    searchResults,
    showResults,
    activeAutoField,
    applyAutoFill,
    onAutoFocus,
  } = autocomplete;

  return (
    <Panel>
      <SectionHeader
        title="Speleracties"
        subtitle="Beheer spelers in arena en queue"
      />

      <Label>@username</Label>

      <div className="relative">
        <Input
          value={username}
          placeholder="@zoeken"
          onFocus={() => onAutoFocus("main", username)}
          onChange={(e) => onAutoFocus("main", e.target.value)}
        />

        {showResults &&
          activeAutoField === "main" &&
          searchResults.length > 0 && (
            <div className="absolute left-0 mt-1 w-full bg-[#1C2129] border border-[#2A3038] rounded-[4px] shadow-xl max-h-56 overflow-auto z-30">
              {searchResults.map((u) => (
                <div
                  key={u.tiktok_id}
                  onClick={() => applyAutoFill(u)}
                  className="px-3 py-2 hover:bg-[#242A33] cursor-pointer text-sm text-slate-200"
                >
                  <span className="font-semibold">{u.display_name}</span>{" "}
                  <span className="text-slate-400">@{u.username}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <Button
          variant="danger"
          onClick={() => emitAdminUser("addToArena", username)}
        >
          → Arena
        </Button>

        <Button
          variant="ghost"
          onClick={() => emitAdminUser("addToQueue", username)}
        >
          → Queue
        </Button>

        <Button
          variant="warning"
          onClick={() => emitAdminUser("giveVip", username)}
        >
          ⭐ Geef VIP
        </Button>

        <Button
          variant="default"
          onClick={() => emitAdminUser("removeVip", username)}
        >
          Verwijder VIP
        </Button>
      </div>
    </Panel>
  );
}
