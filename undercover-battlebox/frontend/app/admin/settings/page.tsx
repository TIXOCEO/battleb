"use client";

import React, { useEffect, useState, useRef } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type {
  AdminAckResponse,
  HostProfile,
  ArenaSettings,
} from "@/lib/adminTypes";
import type { AdminSocketOutbound } from "@/lib/socketClient";

//
// Sanitizers
//
function sanitizeHostUsername(input: string): string {
  return input
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 30);
}

function sanitizeHostId(input: string): string {
  return input.replace(/[^0-9]/g, "").slice(0, 32);
}

//
// STRICT GENERIC EMITTER
//
function emitAdmin<E extends keyof AdminSocketOutbound>(
  event: E,
  ...args: Parameters<AdminSocketOutbound[E]>
) {
  const socket = getAdminSocket();
  try {
    socket.emit(event, ...args);
  } catch (err) {
    console.error("Emit error:", err);
  }
}

//
// Component
//
export default function SettingsPage() {
  const [hostProfiles, setHostProfiles] = useState<HostProfile[]>([]);
  const [activeHost, setActiveHost] = useState<HostProfile | null>(null);

  const [newHostUser, setNewHostUser] = useState("");
  const [newHostId, setNewHostId] = useState("");

  const manualHostIdEdit = useRef(false);
  const tiktokIdInputRef = useRef<HTMLInputElement | null>(null);

  const [settings, setSettings] = useState<ArenaSettings>({
    roundDurationPre: 180,
    roundDurationFinal: 300,
    graceSeconds: 5,
    forceEliminations: true,
  });

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [gameActive, setGameActive] = useState(false);

  //
  // INIT SOCKET
  //
  useEffect(() => {
    const socket = getAdminSocket();

    // Load settings
    emitAdmin("admin:getSettings", {}, (res: any) => {
      if (!res?.success) {
        setStatus("❌ Kon instellingen niet laden");
        return;
      }
      if (res.settings) setSettings(res.settings);
      if (res.gameActive) setGameActive(res.gameActive);
    });

    // Load host profiles
    emitAdmin("admin:getHosts", {}, (res: any) => {
      if (res?.success) {
        setHostProfiles(res.hosts);
        setActiveHost(res.hosts.find((h: HostProfile) => h.active) || null);
      }
    });

    // Socket events
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("hosts", (hosts: HostProfile[]) => {
      setHostProfiles(hosts);
      setActiveHost(hosts.find((h) => h.active) || null);
    });

    socket.on("hostsActiveChanged", () => {
      emitAdmin("admin:getHosts", {}, (res: any) => {
        if (res?.success) {
          setHostProfiles(res.hosts);
          setActiveHost(res.hosts.find((h: HostProfile) => h.active) || null);
        }
      });
    });

    socket.on("gameSession", (s: { active: boolean }) =>
      setGameActive(!!s.active)
    );

    socket.on("settings", (s: Partial<ArenaSettings>) =>
      setSettings((prev) => ({ ...prev, ...s }))
    );

    return () => {
      socket.removeAllListeners("connect");
      socket.removeAllListeners("disconnect");
      socket.removeAllListeners("hosts");
      socket.removeAllListeners("hostsActiveChanged");
      socket.removeAllListeners("settings");
      socket.removeAllListeners("gameSession");
    };
  }, []);

  //
  // AUTO TikTok-ID lookup
  //
  useEffect(() => {
    if (!newHostUser) return;
    if (manualHostIdEdit.current) return;

    let cancel = false;

    const timer = setTimeout(async () => {
      try {
        setNewHostId("...");
        const res = await fetch(`/api/tiktok-id/${newHostUser}`);
        const json = await res.json();

        if (cancel) return;

        setNewHostId(json?.tiktok_id ? String(json.tiktok_id) : "");
      } catch {
        if (!cancel) setNewHostId("");
      }
    }, 400);

    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [newHostUser]);

  //
  // CREATE HOST PROFILE
  //
  const createHostProfile = () => {
    const user = sanitizeHostUsername(newHostUser);
    const id = sanitizeHostId(newHostId);

    if (!user || !id) {
      setStatus("❌ Zowel username als TikTok-ID zijn verplicht");
      return;
    }

    emitAdmin(
      "admin:createHost",
      { label: user, username: user, tiktok_id: id },
      (res) => {
        setStatus(res.success ? "✔ Host-profiel opgeslagen" : `❌ ${res.message}`);

        if (res.success) {
          setNewHostUser("");
          setNewHostId("");
          manualHostIdEdit.current = false;

          emitAdmin("admin:getHosts", {}, (r: any) => {
            if (r.success) {
              setHostProfiles(r.hosts);
              setActiveHost(r.hosts.find((h: HostProfile) => h.active) || null);
            }
          });
        }
      }
    );
  };

  //
  // SET ACTIVE HOST
  //
  const activateProfile = (id: number) => {
    if (gameActive) {
      setStatus("❌ Kan host niet wisselen tijdens actief spel");
      return;
    }

    emitAdmin("admin:setActiveHost", { id }, (res) => {
      setStatus(res.success ? "✔ Actieve host ingesteld" : `❌ ${res.message}`);
    });
  };

  //
  // DELETE HOST
  //
  const deleteProfile = (id: number) => {
    emitAdmin("admin:deleteHost", { id }, (res) => {
      setStatus(res.success ? "✔ Verwijderd" : `❌ ${res.message}`);
    });
  };

  //
  // UPDATE TIMERS
  //
  const updateTimers = () => {
    emitAdmin(
      "admin:updateSettings",
      {
        roundDurationPre: settings.roundDurationPre,
        roundDurationFinal: settings.roundDurationFinal,
        graceSeconds: settings.graceSeconds,
        forceEliminations: settings.forceEliminations,
      },
      (res) =>
        setStatus(
          res.success ? "✔ Timer-instellingen opgeslagen" : `❌ ${res.message}`
        )
    );
  };

  //
  // UI
  //
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">⚙ Admin Settings</h1>

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

      {/* ============================== HOST PROFILES ============================== */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-3">Host-profielen</h2>

        {/* ACTIVE HOST SELECT */}
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
                if (id) activateProfile(id);
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
              <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                Actief
              </span>
            )}
          </div>
        </div>

        {/* PROFILE LIST */}
        <div className="border rounded-xl p-3 bg-gray-50 max-h-80 overflow-y-auto">
          {!hostProfiles.length ? (
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
                  <div className="text-xs text-gray-500">
                    ID: {h.tiktok_id}
                  </div>
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
            TikTok ID
          </label>

          <input
            ref={tiktokIdInputRef}
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
            Opslaan
          </button>
        </div>
      </section>

      {/* ============================== TIMERS ============================== */}
      <section className="bg-white rounded-2xl shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-3">Game timers</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-600">
              Voorronde (sec)
            </label>
            <input
              type="number"
              min={30}
              value={settings.roundDurationPre}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  roundDurationPre: Number(e.target.value),
                }))
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
                setSettings((s) => ({
                  ...s,
                  roundDurationFinal: Number(e.target.value),
                }))
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
                setSettings((s) => ({
                  ...s,
                  graceSeconds: Number(e.target.value),
                }))
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
              setSettings((s) => ({
                ...s,
                forceEliminations: e.target.checked,
              }))
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
