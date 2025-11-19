"use client";

import React, { useEffect, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type { AdminAckResponse } from "@/lib/adminTypes";

// Sanitizer: verwijder alles behalve geldige TikTok characters
function sanitizeHost(input: string): string {
  if (!input) return "";
  return input
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")     // ONLY TikTok-valid characters
    .slice(0, 30);                     // Max 30 chars
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
  const [hostUsername, setHostUsername] = useState(""); // input veld
  const [currentHost, setCurrentHost] = useState("");   // opgeslagen host

  const [settings, setSettings] = useState<ArenaSettings>({
    roundDurationPre: 180,
    roundDurationFinal: 300,
    graceSeconds: 5,
    forceEliminations: true,
  });

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [gameActive, setGameActive] = useState(false);

  // ───────────────────────────────────────────────
  // INIT SOCKET
  // ───────────────────────────────────────────────
  useEffect(() => {
    const socket = getAdminSocket();

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);

    const handleSettings = (s: ArenaSettings) =>
      setSettings((prev) => ({ ...prev, ...s }));

    const handleHost = (h: string) => {
      const clean = sanitizeHost(h || "");
      setCurrentHost(clean);

      // alleen initial sync
      setHostUsername((prev) => {
        if (!prev || prev === currentHost) return clean;
        return prev;
      });
    };

    const handleGameSession = (session: GameSessionState) =>
      setGameActive(!!session?.active);

    // INITIAL LOAD
    socket.emit("admin:getSettings", {}, (res: any) => {
      if (res?.success) {
        if (res.settings) setSettings(res.settings);

        if (typeof res.host === "string") {
          const clean = sanitizeHost(res.host);
          setCurrentHost(clean);
          setHostUsername(clean);
        }

        setGameActive(!!res.gameActive);
        setConnected(true);
      } else {
        setStatus(`❌ ${res?.message || "Kon settings niet laden"}`);
      }
    });

    socket.on("settings", handleSettings);
    socket.on("host", handleHost);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("gameSession", handleGameSession);

    return () => {
      socket.off("settings", handleSettings);
      socket.off("host", handleHost);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("gameSession", handleGameSession);
    };
  }, []);

  // ───────────────────────────────────────────────
  // HOST OPSLAAN
  // ───────────────────────────────────────────────
  const updateHost = () => {
    if (gameActive) {
      setStatus("❌ Host kan niet worden gewijzigd tijdens actief spel");
      return;
    }

    const sanitized = sanitizeHost(hostUsername);

    if (!sanitized) {
      setStatus("❌ Ongeldige TikTok gebruikersnaam");
      return;
    }

    const socket = getAdminSocket();

    socket.emit(
      "admin:setHost",
      { username: sanitized },
      (res: AdminAckResponse) => {
        setStatus(
          res.success ? "✔ Host opgeslagen" : `❌ ${res.message}`
        );
      }
    );
  };

  // ───────────────────────────────────────────────
  // TIMERS OPSLAAN
  // ───────────────────────────────────────────────
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

  // ───────────────────────────────────────────────
  // UI
  // ───────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">⚙ Admin Settings</h1>

      {/* Verbindingsstatus */}
      <div
        className={`text-sm mb-4 px-3 py-1.5 rounded-full inline-block ${
          connected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        }`}
      >
        {connected ? "Verbonden met server" : "❌ Niet verbonden"}
      </div>

      {/* Feedback */}
      {status && (
        <div className="mb-4 p-2 text-center text-sm bg-blue-50 border border-blue-200 text-blue-700 rounded-xl">
          {status}
        </div>
      )}

      {/* HOST INSTELLING */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <div className="text-xs text-gray-500 mb-1">Huidige host</div>

        <div className="text-lg font-semibold mb-3">
          {currentHost ? `@${currentHost}` : "— geen host ingesteld —"}
        </div>

        <label className="text-xs text-gray-600">
          Nieuwe TikTok host username (zonder @)
        </label>

        <input
          type="text"
          value={hostUsername}
          disabled={gameActive}
          onChange={(e) => {
            const clean = sanitizeHost(e.target.value);
            setHostUsername(clean);
          }}
          className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 ${
            gameActive ? "bg-gray-100 cursor-not-allowed" : ""
          }`}
          maxLength={30}
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

      {/* GAME SETTINGS */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-3">Game instellingen</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-600">Voorronde (sec)</label>
            <input
              type="number"
              min={30}
              value={settings.roundDurationPre}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  roundDurationPre: Number(e.target.value),
                }))
              }
              className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Finale (sec)</label>
            <input
              type="number"
              min={60}
              value={settings.roundDurationFinal}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  roundDurationFinal: Number(e.target.value),
                }))
              }
              className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Grace (sec)</label>
            <input
              type="number"
              min={0}
              value={settings.graceSeconds}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  graceSeconds: Number(e.target.value),
                }))
              }
              className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm"
            />
          </div>
        </div>

        {/* FORCE ELIMINATIONS */}
        <div className="mt-4">
          <label className="text-xs text-gray-600 flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.forceEliminations}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  forceEliminations: e.target.checked,
                }))
              }
            />
            Forceer eliminaties vereist voor ronde-einde
          </label>
        </div>

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
