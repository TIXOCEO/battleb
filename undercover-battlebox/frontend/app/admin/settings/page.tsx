// app/admin/settings/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type { AdminAckResponse } from "@/lib/adminTypes";

type ArenaSettings = {
  roundDurationPre: number;
  roundDurationFinal: number;
  graceSeconds: number;
};

type GameSessionState = {
  active: boolean;
  gameId: number | null;
};

export default function SettingsPage() {
  const [hostUsername, setHostUsername] = useState("");
  const [currentHost, setCurrentHost] = useState("");
  const [settings, setSettings] = useState<ArenaSettings>({
    roundDurationPre: 180,
    roundDurationFinal: 300,
    graceSeconds: 5,
  });

  const [status, setStatus] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [gameActive, setGameActive] = useState(false);

  // ───────────────────────────────────────────────
  // SOCKET INITIALISATIE
  // ───────────────────────────────────────────────
  useEffect(() => {
    const socket = getAdminSocket();

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);

    const handleSettings = (s: ArenaSettings) => setSettings(s);

    const handleHost = (h: string) => {
      const clean = h?.trim() || "";
      setCurrentHost(clean);
      setHostUsername(clean);
    };

    const handleGameSession = (session: GameSessionState) => {
      setGameActive(!!session?.active);
    };

    // 1) Huidige settings + host binnenhalen
    socket.emit("admin:getSettings", {}, (res: any) => {
      if (res?.success) {
        if (res.settings) setSettings(res.settings);
        if (typeof res.host === "string") {
          setCurrentHost(res.host);
          setHostUsername(res.host);
        }
        setConnected(true);
      } else {
        setStatus(`❌ ${res?.message || "Kon settings niet laden"}`);
      }
    });

    // Registreren
    socket.on("settings", handleSettings);
    socket.on("host", handleHost);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("gameSession", handleGameSession);

    // Cleanup
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
      setStatus("❌ Host kan niet worden gewijzigd tijdens een actief spel");
      return;
    }

    if (!hostUsername.trim()) return;

    const socket = getAdminSocket();

    const payload = {
      username: hostUsername.trim().replace(/^@/, ""),
    };

    socket.emit("admin:setHost", payload, (res: AdminAckResponse) => {
      if (res.success) {
        setStatus("✔ Host opgeslagen");
      } else {
        setStatus(`❌ ${res.message}`);
      }
    });
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

      {/* VERBINDINGS STATUS */}
      <div
        className={`text-sm mb-4 px-3 py-1.5 rounded-full inline-block ${
          connected
            ? "bg-green-100 text-green-700"
            : "bg-red-100 text-red-700"
        }`}
      >
        {connected ? "Verbonden met server" : "❌ Niet verbonden"}
      </div>

      {/* STATUS MELDING */}
      {status && (
        <div className="mb-4 p-2 text-center text-sm bg-blue-50 border border-blue-200 text-blue-700 rounded-xl">
          {status}
        </div>
      )}

      {/* HUIDIGE HOST */}
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
          onChange={(e) => setHostUsername(e.target.value)}
          disabled={gameActive}
          className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 ${
            gameActive ? "bg-gray-100 cursor-not-allowed" : ""
          }`}
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
            Host kan alleen worden gewijzigd als er géén spel actief is.
            Stop eerst het huidige spel via het dashboard.
          </p>
        )}
      </section>

      {/* TIMER INSTELLINGEN */}
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

        <button
          onClick={updateTimers}
          className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-full text-sm"
        >
          Instellingen opslaan
        </button>
      </section>
    </div>
  );
}
