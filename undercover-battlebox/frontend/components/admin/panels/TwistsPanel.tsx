"use client";

import React from "react";
import Panel from "@/components/admin/ui/Panel";
import SectionHeader from "@/components/admin/ui/SectionHeader";
import Input from "@/components/admin/ui/Input";
import Label from "@/components/admin/ui/Label";
import Button from "@/components/admin/ui/Button";

import type { AdminSocketOutbound } from "@/lib/adminTypes";
import type { AutocompleteUser } from "@/types/AutocompleteUser";
import type { TwistType } from "@/lib/twist-definitions";
import type { EmitAdminFn } from "@/types/EmitAdminFn";

interface TwistsPanelProps {
  twistUserGive: string;
  twistTypeGive: TwistType | "";
  twistUserUse: string;
  twistTargetUse: string;
  twistTypeUse: TwistType | "";

  setTwistUserGive: (v: string) => void;
  setTwistTypeGive: (v: TwistType | "") => void;
  setTwistUserUse: (v: string) => void;
  setTwistTargetUse: (v: string) => void;
  setTwistTypeUse: (v: TwistType | "") => void;

  searchResults: AutocompleteUser[];
  showResults: boolean;
  activeAutoField: "give" | "use" | "target" | "main" | null;

  applyAutoFill: (u: AutocompleteUser) => void;
  onAutoFocus: (field: "give" | "use" | "target" | "main", value: string) => void;

  emitAdmin: EmitAdminFn;
}

const TWIST_OPTIONS: TwistType[] = [
  "galaxy",
  "moneygun",
  "immune",
  "heal",
  "bomb",
  "diamondpistol",
  "breaker",
];

export default function TwistsPanel({
  twistUserGive,
  twistTypeGive,
  twistUserUse,
  twistTargetUse,
  twistTypeUse,

  setTwistUserGive,
  setTwistTypeGive,
  setTwistUserUse,
  setTwistTargetUse,
  setTwistTypeUse,

  searchResults,
  showResults,
  activeAutoField,
  applyAutoFill,
  onAutoFocus,

  emitAdmin,
}: TwistsPanelProps) {
  return (
    <Panel>
      <SectionHeader title="Twists" subtitle="Geven & gebruiken (admin)" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ============================================================
            GIVE TWIST
        ============================================================ */}
        <div className="bg-[#13161C] border border-[#2A3038] rounded-[4px] p-4 relative">
          <h3 className="font-semibold text-slate-200 mb-3">
            Twist geven aan speler
          </h3>

          <Label>@username</Label>
          <div className="relative">
            <Input
              value={twistUserGive}
              onFocus={() => onAutoFocus("give", twistUserGive)}
              onChange={(e) => onAutoFocus("give", e.target.value)}
              placeholder="@gebruiker"
            />

            {/* AUTOCOMPLETE – GIVE */}
            {showResults &&
              searchResults.length > 0 &&
              activeAutoField === "give" && (
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

          <Label className="mt-3">Kies twist</Label>
          <select
            value={twistTypeGive}
            onChange={(e) => setTwistTypeGive(e.target.value as TwistType)}
            className="w-full bg-[#13161C] border border-[#2A3038] rounded-[4px] px-3 py-2 text-sm text-slate-200 focus:border-[#4E97FF]"
          >
            <option value="">-- Kies twist --</option>
            {TWIST_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <Button
            variant="primary"
            className="mt-3 w-full"
            onClick={() =>
              emitAdmin("giveTwist", {
                username: twistUserGive,
                twist: twistTypeGive,
              })
            }
          >
            Geef twist
          </Button>
        </div>

        {/* ============================================================
            USE TWIST (ADMIN)
        ============================================================ */}
        <div className="bg-[#13161C] border border-[#2A3038] rounded-[4px] p-4 relative">
          <h3 className="font-semibold text-slate-200 mb-3">
            Twist gebruiken (admin)
          </h3>

          <Label>Gebruiker</Label>
          <div className="relative">
            <Input
              value={twistUserUse}
              onFocus={() => onAutoFocus("use", twistUserUse)}
              onChange={(e) => onAutoFocus("use", e.target.value)}
              placeholder="@gebruiker"
            />

            {/* AUTOCOMPLETE – USE */}
            {showResults &&
              searchResults.length > 0 &&
              activeAutoField === "use" && (
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

          <Label className="mt-3">Twist</Label>
          <select
            value={twistTypeUse}
            onChange={(e) => setTwistTypeUse(e.target.value as TwistType)}
            className="w-full bg-[#13161C] border border-[#2A3038] rounded-[4px] px-3 py-2 text-sm text-slate-200 focus:border-[#4E97FF]"
          >
            <option value="">-- Kies twist --</option>
            {TWIST_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <Label className="mt-3">Target (optioneel)</Label>
          <div className="relative">
            <Input
              value={twistTargetUse}
              onFocus={() => onAutoFocus("target", twistTargetUse)}
              onChange={(e) => onAutoFocus("target", e.target.value)}
              placeholder="@target"
            />

            {/* AUTOCOMPLETE – TARGET */}
            {showResults &&
              searchResults.length > 0 &&
              activeAutoField === "target" && (
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

          <Button
            variant="info"
            className="mt-3 w-full"
            onClick={() =>
              emitAdmin("useTwist", {
                username: twistUserUse,
                twist: twistTypeUse,
                target: twistTargetUse,
              })
            }
          >
            Gebruik twist
          </Button>
        </div>
      </div>
    </Panel>
  );
}
