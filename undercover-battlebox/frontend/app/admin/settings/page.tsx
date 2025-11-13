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
  const [currentHost, setCurrentHost] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const [settings, setSettings] = useState<ArenaSettings>({
    roundDurationPre: 180,
    roundDurationFinal: 300,
    graceSeconds: 5,
  });

  useEffect(() => {
    const socket = getAdminSocket();

    // Huidige settings + host ophalen via ACK
    socket.emit("admin:getSettings", {}, (res: any) => {
      if (res.success) {
        setSettings(res.settings);
        setHostUsername(res.host);
        setCurrentHost(res.host);
      }
    });

    // Host live update
    socket.on("host", (h: string) => setCurrentHost(h));

    // Settings live update
    socket.on("settings", (s: ArenaSettings) => setSettings(s));

    return () => {
      socket.removeAllListeners();
    };
  }, []);

  // Opslaan host
  const updateHost = () => {
    const clean = hostUsername.trim().replace(/^@/, "");

    if (!clean) return;

    const socket = getAdminSocket();
    socket.emit(
      "admin:setHost",
      { username: clean },
      (res: AdminAckResponse) =>
        setStatus(res.success ? "✔ Host opgeslagen" : `❌ ${res.message}`)
    );
  };

  return (
    <div className="max-w-3xl mx-auto">

      {/* STATUS */}
      {status && (
        <div className="mb-4 p-2 px-3 text-center text-sm bg-blue-50 border border-blue-200 text-blue-700 rounded-xl">
          {status}
        </div>
      )}

      {/* HUIDIGE HOST BADGE */}
      <div className="mb-4">
        <span className="text-xs font-semibold text-gray-500">Huidige host:</span>
        <div className="mt-1 inline-block px-3 py-1 rounded-full bg-gray-200 text-gray-900 text-sm font-semibold">
          @{currentHost || "geen host ingesteld"}
        </div>
      </div>

      {/* HOST INSTELLING */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h1 className="text-xl font-bold mb-2">Host instellingen</h1>
        <p className="text-sm text-gray-600 mb-3">
          De host is de gebruiker naar wie de gifts worden herkend als “host gifts”.
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

      {/* EXTRA */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-2">Extra instellingen</h2>
        <p className="text-sm text-gray-600">
          Timerinstellingen worden beheerd via het Hoofd Dashboard.
        </p>
      </section>

    </div>
  );
}
