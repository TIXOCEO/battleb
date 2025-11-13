"use client";

import React, { useEffect, useState } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type { AdminAckResponse } from "@/lib/adminTypes";

type ArenaSettings = {
  roundDurationPre: number;
  roundDurationFinal: number;
  graceSeconds: number;
};

export default function SettingsPage() {
  const [hostUsername, setHostUsername] = useState("");
  const [settings, setSettings] = useState<ArenaSettings>({
    roundDurationPre: 180,
    roundDurationFinal: 300,
    graceSeconds: 5,
  });

  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const socket = getAdminSocket();

    // Ontvang huidige settings
    socket.emit("admin:getSettings", {}, (res: any) => {
      if (res.success) {
        setSettings(res.settings);
        setHostUsername(res.host);
      }
    });

    socket.on("settings", (s: ArenaSettings) => setSettings(s));

    return () => socket.disconnect();
  }, []);

  const updateHost = () => {
    if (!hostUsername.trim()) return;
    const socket = getAdminSocket();
    socket.emit(
      "admin:setHost",
      { username: hostUsername.trim().replace(/^@/, "") },
      (res: AdminAckResponse) =>
        setStatus(res.success ? "✔ Host opgeslagen" : `❌ ${res.message}`)
    );
  };

  const updateTimers = () => {
    const socket = getAdminSocket();
    socket.emit(
      "admin:updateSettings",
      {
        roundDurationPre: settings.roundDurationPre,
        roundDurationFinal: settings.roundDurationFinal,
        graceSeconds: settings.graceSeconds,
      },
      (res: AdminAckResponse) =>
        setStatus(res.success ? "✔ Timer-instellingen opgeslagen" : `❌ ${res.message}`)
    );
  };

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-4">⚙ Admin Settings</h1>

      {/* STATUS BALK */}
      {status && (
        <div className="mb-4 p-2 text-center text-sm bg-blue-50 border border-blue-200 text-blue-700 rounded-xl">
          {status}
        </div>
      )}

      {/* HOST INSTELLING */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-2">Host instellingen</h2>
        <p className="text-sm text-gray-600 mb-3">
          De host is de gebruiker naar wie de gifts worden herkend als "host gifts".
        </p>

        <label className="text-xs text-gray-600">TikTok username (zonder @)</label>
        <input
          type="text"
          value={hostUsername}
          onChange={(e) => setHostUsername(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1"
        />

        <button
          onClick={updateHost}
          className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-full text-sm"
        >
          Opslaan
        </button>
      </section>

      {/* TIMER INSTELLINGEN */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-2">Game instellingen</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-600">Voorronde (sec)</label>
            <input
              type="number"
              min={30}
              value={settings.roundDurationPre}
              onChange={(e) =>
                setSettings({ ...settings, roundDurationPre: Number(e.target.value) })
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
                setSettings({ ...settings, roundDurationFinal: Number(e.target.value) })
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
                setSettings({ ...settings, graceSeconds: Number(e.target.value) })
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
    </main>
  );
}
