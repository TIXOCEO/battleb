"use client";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import React, { useEffect, useState, useRef } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type { AdminAckResponse } from "@/lib/adminTypes";

/* ============================================================
   SANITIZERS
============================================================ */
function sanitizeHostUsername(input: string): string {
  if (!input) return "";
  return input
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 30);
}

function sanitizeHostId(input: string): string {
  if (!input) return "";
  return input.replace(/[^0-9]/g, "").slice(0, 32);
}

/* ============================================================
   TYPES
============================================================ */
type ArenaSettings = {
  roundDurationPre: number;
  roundDurationFinal: number;
  graceSeconds: number;
  forceEliminations: boolean;
};

type HostProfile = {
  id: number;
  username: string;
  tiktok_id: string;
  active: boolean;
};

/* ============================================================
   COMPONENT
============================================================ */
export default function SettingsPage() {
  // ------------------------------------ HOST PROFILES
  const [hostProfiles, setHostProfiles] = useState<HostProfile[]>([]);
  const [activeHost, setActiveHost] = useState<HostProfile | null>(null);

  // ------------------------------------ NEW HOST FORM
  const [newHostUser, setNewHostUser] = useState("");
  const [newHostId, setNewHostId] = useState("");
  const manualHostIdEdit = useRef(false);
  const tiktokIdInputRef = useRef<HTMLInputElement | null>(null);

  // ------------------------------------ GENERAL SETTINGS
  const [settings, setSettings] = useState<ArenaSettings>({
    roundDurationPre: 180,
    roundDurationFinal: 300,
    graceSeconds: 5,
    forceEliminations: true,
  });

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [gameActive, setGameActive] = useState(false);

  /* ============================================================
     INIT SOCKET
  ============================================================ */
  useEffect(() => {
    const socket: any = getAdminSocket();

    // ---- GET SETTINGS INIT
    socket.emit("admin:getSettings", {}, (res: any) => {
      if (!res?.success) {
        setStatus(`❌ ${res?.message || "Kon instellingen niet laden"}`);
        return;
      }
      setSettings(res.settings);
      setGameActive(!!res.gameActive);
      setConnected(true);
    });

    // ---- GET HOSTS INIT
    socket.emit("admin:getHosts", {}, (res: any) => {
      if (res?.success) {
        setHostProfiles(res.hosts || []);
        const active = res.hosts?.find((h: any) => h.active) || null;
        setActiveHost(active);
      }
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("hosts", (hosts: any[]) => {
      setHostProfiles(hosts);
      setActiveHost(hosts.find((h) => h.active) || null);
    });

    socket.on("hostsActiveChanged", () => {
      socket.emit("admin:getHosts", {}, (res: any) => {
        if (res.success) {
          setHostProfiles(res.hosts);
          setActiveHost(res.hosts.find((h: any) => h.active) || null);
        }
      });
    });

    socket.on("gameSession", (s: any) => setGameActive(!!s?.active));

    socket.on("settings", (s: ArenaSettings) =>
      setSettings((prev) => ({ ...prev, ...s }))
    );

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("hosts");
      socket.off("hostsActiveChanged");
      socket.off("settings");
      socket.off("gameSession");
    };
  }, []);

  /* ============================================================
     AUTOLOOKUP TIKTOK-ID
  ============================================================ */
  useEffect(() => {
    if (!newHostUser) return;
    if (manualHostIdEdit.current) return;

    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        setNewHostId("...");
        const res = await fetch(`/api/tiktok-id/${newHostUser}`);
        const json = await res.json();

        if (cancelled) return;

        if (json.success && json.tiktok_id) {
          setNewHostId(String(json.tiktok_id));
        } else {
          setNewHostId("");
        }
      } catch {
        if (!cancelled) setNewHostId("");
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [newHostUser]);

  /* ============================================================
     CREATE HOST
  ============================================================ */
  const createHostProfile = () => {
    const cleanUser = sanitizeHostUsername(newHostUser);
    const cleanId = sanitizeHostId(newHostId);

    if (!cleanUser || !cleanId) {
      setStatus("❌ Zowel username als TikTok-ID zijn verplicht");
      return;
    }

    const socket: any = getAdminSocket();

    socket.emit(
      "admin:createHost",
      {
        label: cleanUser,
        username: cleanUser,
        tiktok_id: cleanId,
      },
      (res: AdminAckResponse) => {
        setStatus(res.success ? "✔ Host-profiel opgeslagen" : `❌ ${res.message}`);

        if (res.success) {
          setNewHostUser("");
          setNewHostId("");
          manualHostIdEdit.current = false;

          socket.emit("admin:getHosts", {}, (r: any) => {
            if (r.success) {
              setHostProfiles(r.hosts);
              setActiveHost(r.hosts.find((h: any) => h.active) || null);
            }
          });
        }
      }
    );
  };

  /* ============================================================
     ACTIVATE HOST
  ============================================================ */
  const activateProfile = (id: number) => {
    if (gameActive) {
      setStatus("❌ Kan host niet wisselen tijdens actief spel");
      return;
    }
    const socket: any = getAdminSocket();
    socket.emit("admin:setActiveHost", { id }, (res: any) => {
      setStatus(res.success ? "✔ Actieve host ingesteld" : `❌ ${res.message}`);
    });
  };

  /* ============================================================
     DELETE HOST
  ============================================================ */
  const deleteProfile = (id: number) => {
    const socket: any = getAdminSocket();
    socket.emit("admin:deleteHost", { id }, (res: any) => {
      setStatus(res.success ? "✔ Verwijderd" : `❌ ${res.message}`);
    });
  };

  /* ============================================================
     UPDATE TIMERS
  ============================================================ */
  const updateTimers = () => {
    const socket: any = getAdminSocket();
    socket.emit(
      "admin:updateSettings",
      {
        roundDurationPre: settings.roundDurationPre,
        roundDurationFinal: settings.roundDurationFinal,
        graceSeconds: settings.graceSeconds,
        forceEliminations: settings.forceEliminations,
      },
      (res: any) => {
        setStatus(res.success ? "✔ Timer-instellingen opgeslagen" : `❌ ${res.message}`);
      }
    );
  };

  /* ============================================================
     UI
  ============================================================ */
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">⚙ Admin Settings</h1>

      {/* CONNECTION */}
      <div
        className={`text-sm mb-4 px-3 py-1 rounded-full inline-block ${
          connected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        }`}
      >
        {connected ? "Verbonden met server" : "❌ Niet verbonden"}
      </div>

      {/* STATUS */}
      {status && (
        <div className="mb-4 p-2 text-center text-sm bg-blue-50 border border-blue-200 text-blue-700 rounded-xl">
          {status}
        </div>
      )}

      {/* ============================================================
         HOST PROFILES
      ============================================================ */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-3">Host-profielen</h2>

        {/* ACTIVE HOST SELECTOR */}
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-1">Actieve host:</div>

          <div className="flex items-center gap-2">
            <select
              disabled={gameActive}
              className={`px-3 py-2 border rounded-lg text-sm bg-white ${
                gameActive ? "opacity-50 cursor-not-allowed" : ""
              }`}
              value={activeHost?.id ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value);
                if (!id) return;
                activateProfile(id);
              }}
            >
              <option value="">
                {activeHost ? "Selecteer andere host…" : "Geen actieve host"}
              </option>

              {hostProfiles.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.active ? "⭐ " : ""}@{h.username} (ID: {h.tiktok_id})
                </option>
              ))}
            </select>

            {activeHost && (
              <div className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                Actief
              </div>
            )}
          </div>
        </div>

        {/* HOST LIST */}
        <div className="border rounded-xl p-3 bg-gray-50 max-h-80 overflow-y-auto">
          {hostProfiles.length === 0 ? (
            <p className="text-gray-500 text-sm italic">
              Nog geen host-profielen opgeslagen.
            </p>
          ) : (
            hostProfiles.map((h) => (
              <div
                key={h.id}
                className={`flex items-center justify-between p-2 rounded-lg mb-2 ${
                  h.active ? "bg-blue-100" : "bg-white"
                }`}
              >
                <div>
                  <div className="font-semibold">@{h.username}</div>
                  <div className="text-xs text-gray-500">ID: {h.tiktok_id}</div>
                </div>

                <div className="flex gap-2">
                  {!h.active && (
                    <button
                      onClick={() => activateProfile(h.id)}
                      className="px-3 py-1 text-xs bg-green-600 text-white rounded-full"
                    >
                      Activeer
                    </button>
                  )}
                  <button
                    onClick={() => deleteProfile(h.id)}
                    className="px-3 py-1 text-xs bg-red-600 text-white rounded-full"
                  >
                    Verwijder
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ADD HOST */}
        <div className="mt-5">
          <h3 className="text-sm font-semibold mb-2">
            Nieuw host-profiel toevoegen
          </h3>

          <label className="text-xs text-gray-600">Username</label>
          <input
            type="text"
            className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
            value={newHostUser}
            onChange={(e) => {
              manualHostIdEdit.current = false;
              setNewHostUser(sanitizeHostUsername(e.target.value));
            }}
          />

          <label
            className="text-xs text-gray-600 cursor-pointer"
            onClick={() => tiktokIdInputRef.current?.focus()}
          >
            TikTok ID (klik om te focussen)
          </label>

          <input
            ref={tiktokIdInputRef}
            type="text"
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono mb-3"
            value={newHostId}
            onChange={(e) => {
              manualHostIdEdit.current = true;
              setNewHostId(sanitizeHostId(e.target.value));
            }}
          />

          <button
            onClick={createHostProfile}
            className="px-4 py-2 rounded-full text-sm text-white bg-blue-600 hover:bg-blue-700"
          >
            Host-profiel opslaan
          </button>
        </div>
      </section>

      {/* ============================================================
         TIMERS
      ============================================================ */}
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
              className="w-full border rounded-lg px-3 py-1 text-sm"
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
              className="w-full border rounded-lg px-3 py-1 text-sm"
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
              className="w-full border rounded-lg px-3 py-1 text-sm"
            />
          </div>
        </div>

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
