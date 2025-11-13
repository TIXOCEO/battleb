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

    // Huidige settings + host ophalen via ack
    socket.emit("admin:getSettings", {}, (res: any) => {
      if (res.success) {
        setSettings(res.settings);
        setHostUsername(res.host);
      }
    });

    // Settings live updates
    socket.on("settings", (s: ArenaSettings) => setSettings(s));

    return () => {
      socket.removeAllListeners();
    };
  }, []);

  // Opslaan HOST
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

  return (
    <div className="max-w-3xl mx-auto">

      {/* STATUS MELDING */}
      {status && (
        <div className="mb-4 p-2 text-center text-sm bg-blue-50 border border-blue-200 text-blue-700 rounded-xl">
          {status}
        </div>
      )}

      {/* HOST INSTELLING */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h1 className="text-xl font-bold mb-2">Host instellingen</h1>
        <p className="text-sm text-gray-600 mb-3">
          De host is de gebruiker naar wie de gifts worden herkend als “host gifts”.
        </p>

        <label className="text-xs text-gray-600">
          TikTok username (zonder @)
        </label>
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

      {/* TOEKOMSTIGE EXTRA INSTELLINGEN */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-2">Extra instellingen</h2>
        <p className="text-sm text-gray-600">
          Timerinstellingen worden nu beheerd via het hoofd-dashboard.
        </p>
      </section>

    </div>
  );
}
