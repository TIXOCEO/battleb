"use client";

import React, { useEffect, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type { AdminAckResponse } from "@/lib/adminTypes";

// Sanitizer username
function sanitizeHostUsername(input: string): string {
  if (!input) return "";
  return input
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 30);
}

// Sanitizer TikTok ID (numeric only)
function sanitizeHostId(input: string): string {
  if (!input) return "";
  return input.replace(/[^0-9]/g, "").slice(0, 32);
}

type ArenaSettings = {
  roundDurationPre: number;
  roundDurationFinal: number;
  graceSeconds: number;
  forceEliminations: boolean;
};

type GameSessionState = {
  active: boolean;
  gameId: number | null;
};

export default function SettingsPage() {
  const [hostUsername, setHostUsername] = useState("");
  const [hostId, setHostId] = useState("");

  const [currentHostUser, setCurrentHostUser] = useState("");
  const [currentHostId, setCurrentHostId] = useState("");

  const [settings, setSettings] = useState<ArenaSettings>({
    roundDurationPre: 180,
    roundDurationFinal: 300,
    graceSeconds: 5,
    forceEliminations: true,
  });

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [gameActive, setGameActive] = useState(false);

  // ---------------------------------------------------------------------
  // INIT SOCKET
  // ---------------------------------------------------------------------
  useEffect(() => {
    const socket = getAdminSocket();

    socket.emit("admin:getSettings", {}, (res: any) => {
      if (!res?.success) {
        setStatus(`❌ ${res?.message || "Kon instellingen niet laden"}`);
        return;
      }

      if (res.settings) setSettings(res.settings);

      if (typeof res.host === "string") {
        const cleanUser = sanitizeHostUsername(res.host);
        setCurrentHostUser(cleanUser);
        setHostUsername(cleanUser);
      }

      if (res.hostId) {
        const cleanId = sanitizeHostId(String(res.hostId));
        setCurrentHostId(cleanId);
        setHostId(cleanId);
      }

      setGameActive(!!res.gameActive);
      setConnected(true);
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("host", (h: string) => {
      const clean = sanitizeHostUsername(h || "");
      setCurrentHostUser(clean);
    });

    socket.on("hostId", (id: string) => {
      const clean = sanitizeHostId(id || "");
      setCurrentHostId(clean);
    });

    socket.on("settings", (s: ArenaSettings) =>
      setSettings((prev) => ({ ...prev, ...s }))
    );

    socket.on("gameSession", (s: GameSessionState) =>
      setGameActive(!!s?.active)
    );

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("settings");
      socket.off("host");
      socket.off("hostId");
      socket.off("gameSession");
    };
  }, []);

  // ---------------------------------------------------------------------
  // HOST OPSLAAN
  // ---------------------------------------------------------------------
  const updateHost = () => {
    if (gameActive) {
      setStatus("❌ Host kan niet worden gewijzigd tijdens een actief spel");
      return;
    }

    const cleanUser = sanitizeHostUsername(hostUsername);
    const cleanId = sanitizeHostId(hostId);

    if (!cleanUser || !cleanId) {
      setStatus("❌ Zowel username als TikTok ID zijn verplicht");
      return;
    }

    const socket = getAdminSocket();

    socket.emit(
      "admin:setHost",
      { username: cleanUser, tiktok_id: cleanId },
      (res: AdminAckResponse) => {
        setStatus(
          res.success ? "✔ Host succesvol opgeslagen" : `❌ ${res.message}`
        );
      }
    );
  };

  // ---------------------------------------------------------------------
  // TIMERS OPSLAAN
  // ---------------------------------------------------------------------
  const updateTimers = () => {
    const socket = getAdminSocket();
    socket.emit(
      "admin:updateSettings",
      {
        roundDurationPre: settings.roundDurationPre,
        roundDurationFinal: settings.roundDurationFinal,
        graceSeconds: settings.graceSeconds,
        forceEliminations: settings.forceEliminations,
      },
      (res: AdminAckResponse) => {
        setStatus(
          res.success
            ? "✔ Timer-instellingen opgeslagen"
            : `❌ ${res.message}`
        );
      }
    );
  };

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">⚙ Admin Settings</h1>

      {/* Status */}
      <div
        className={`text-sm mb-4 px-3 py-1 rounded-full inline-block ${
          connected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        }`}
      >
        {connected ? "Verbonden met server" : "❌ Niet verbonden"}
      </div>

      {status && (
        <div className="mb-4 p-2 text-center text-sm bg-blue-50 border border-blue-200 text-blue-700 rounded-xl">
          {status}
        </div>
      )}

      {/* HOST SETTINGS */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-3">Host instellingen</h2>

        <div className="text-xs text-gray-500 mb-1">Huidige host</div>

        <div className="text-lg font-semibold mb-1">
          {currentHostUser ? `@${currentHostUser}` : "— geen host username —"}
        </div>
        <div className="text-lg font-mono text-gray-600 mb-4">
          {currentHostId ? `ID: ${currentHostId}` : "— geen host ID —"}
        </div>

        {/* Nieuwe host username */}
        <label className="text-xs text-gray-600">Nieuwe username</label>
        <input
          type="text"
          maxLength={30}
          value={hostUsername}
          onChange={(e) =>
            setHostUsername(sanitizeHostUsername(e.target.value))
          }
          disabled={gameActive}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
        />

        {/* Nieuwe host ID */}
        <label className="text-xs text-gray-600">Nieuwe TikTok ID</label>
        <input
          type="text"
          maxLength={32}
          value={hostId}
          onChange={(e) => setHostId(sanitizeHostId(e.target.value))}
          disabled={gameActive}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 font-mono"
        />

        <button
          onClick={updateHost}
          disabled={gameActive}
          className={`mt-3 px-4 py-2 rounded-full text-sm text-white ${
            gameActive
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          Host opslaan
        </button>

        {gameActive && (
          <p className="mt-2 text-xs text-amber-600">
            Host kan alleen worden gewijzigd wanneer er géén spel actief is.
          </p>
        )}
      </section>

      {/* TIMERS */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-3">Game timers</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-600">Voorronde (sec)</label>
            <input
              type="number"
              min={30}
              value={settings.roundDurationPre}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  roundDurationPre: Number(e.target.value),
                })
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-1 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Finale (sec)</label>
            <input
              type="number"
              min={60}
              value={settings.roundDurationFinal}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  roundDurationFinal: Number(e.target.value),
                })
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-1 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Grace (sec)</label>
            <input
              type="number"
              min={0}
              value={settings.graceSeconds}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  graceSeconds: Number(e.target.value),
                })
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-1 text-sm"
            />
          </div>
        </div>

        {/* Force eliminations */}
        <label className="mt-4 flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={settings.forceEliminations}
            onChange={(e) =>
              setSettings({
                ...settings,
                forceEliminations: e.target.checked,
              })
            }
          />
          Forceer eliminaties vereist
        </label>

        <button
          onClick={updateTimers}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-full text-sm"
        >
          Instellingen opslaan
        </button>
      </section>
    </div>
  );
}
