// app/admin/layout.tsx
import type { ReactNode } from "react";

export default function AdminLayout() {
  return (
    <html lang="nl">
      <body className="min-h-screen bg-[#f5f5f7] text-gray-900">
        <div className="min-h-screen flex flex-col">
          {/* Simple topbar */}
          <header className="h-14 flex items-center justify-between px-4 md:px-6 border-b border-gray-200 bg-white shadow-sm">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-[#ff4d4f] flex items-center justify-center text-white text-xs font-bold">
                UB
              </div>
              <div>
                <div className="text-sm font-semibold">
                  Undercover BattleBox – Admin
                </div>
                <div className="text-[11px] text-gray-500">
                  Live control panel
                </div>
              </div>
            </div>
            <span className="text-[11px] text-gray-500">
              Connected as <strong>Admin</strong>
            </span>
          </header>

          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}


// ---- Top toggles component ----
function TopToggles({
  toggles,
  setToggles,
  roundLabel,
  timeLeft,
}: {
  toggles: any;
  setToggles: (fn: (t: any) => any) => void;
  roundLabel: string;
  timeLeft: number | null;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
      <div className="flex flex-wrap gap-3 items-center text-[11px]">
        <TogglePill
          label="Queue"
          active={toggles.queueOpen}
          onClick={() =>
            setToggles((prev: any) => ({ ...prev, queueOpen: !prev.queueOpen }))
          }
        />
        <TogglePill
          label="Boosters"
          active={toggles.boostersEnabled}
          onClick={() =>
            setToggles((prev: any) => ({
              ...prev,
              boostersEnabled: !prev.boostersEnabled,
            }))
          }
        />
        <TogglePill
          label="Twists"
          active={toggles.twistsEnabled}
          onClick={() =>
            setToggles((prev: any) => ({
              ...prev,
              twistsEnabled: !prev.twistsEnabled,
            }))
          }
        />
        <TogglePill
          label={`Ronde: ${toggles.roundType === "voorronde" ? "Voorronde" : "Finale"}`}
          active={toggles.roundType === "finale"}
          onClick={() =>
            setToggles((prev: any) => ({
              ...prev,
              roundType: prev.roundType === "voorronde" ? "finale" : "voorronde",
            }))
          }
        />
        <TogglePill
          label="Debug logs"
          active={toggles.debugLogs}
          onClick={() =>
            setToggles((prev: any) => ({
              ...prev,
              debugLogs: !prev.debugLogs,
            }))
          }
        />
      </div>

      <div className="flex flex-col items-end text-[11px] text-gray-500">
        <span>Dagreset: {toggles.dayResetTime}</span>
        {timeLeft !== null && (
          <span>
            Live ronde: <strong>{roundLabel}</strong>
          </span>
        )}
      </div>
    </div>
  );
}

function TogglePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full border text-[11px] font-medium transition ${
        active
          ? "border-[#ff4d4f] bg-[#ff4d4f]/10 text-[#ff4d4f]"
          : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );
}

// ---- Arena grid ----
function ArenaGrid({
  players,
  onSelect,
}: {
  players: ArenaPlayer[];
  onSelect: (p: ArenaPlayer) => void;
}) {
  const slots = 8;
  const filled = players.slice(0, slots);
  const emptyCount = slots - filled.length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {filled.map((player, idx) => (
        <ArenaPlayerCard
          key={player.id}
          index={idx + 1}
          player={player}
          onClick={() => onSelect(player)}
        />
      ))}

      {Array.from({ length: emptyCount }).map((_, idx) => (
        <EmptySlot key={`empty-${idx}`} index={filled.length + idx + 1} />
      ))}
    </div>
  );
}

function statusClass(status: "alive" | "eliminated") {
  if (status === "alive") {
    return "bg-[#ff4d4f] text-white";
  }
  return "bg-gray-200 text-gray-500 line-through";
}

function ArenaPlayerCard({
  index,
  player,
  onClick,
}: {
  index: number;
  player: ArenaPlayer;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl bg-white border border-gray-200 shadow-sm px-3 py-2.5 flex flex-col gap-1 hover:border-[#ff4d4f] hover:shadow-md transition"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-gray-900">#{index}</span>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusClass(
            player.status
          )}`}
        >
          {player.status === "alive" ? "Active" : "Eliminated"}
        </span>
      </div>

      <div className="text-sm font-medium text-gray-900 truncate">
        @{player.display_name ?? player.username}
      </div>

      <div className="flex items-center justify-between text-[11px] text-gray-600 mt-1">
        <span>
          Ronde:{" "}
          <strong>
            {player.diamonds.toLocaleString("nl-NL")} /{" "}
            {/* totalPoints komt later uit backend; nu nog niet in payload */}
          </strong>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-gray-400">Boosters:</span>
          {player.boosters?.length ? (
            player.boosters.map((b) => (
              <span
                key={b}
                className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-semibold"
              >
                {b}
              </span>
            ))
          ) : (
            <span className="text-gray-400 text-[10px]">geen</span>
          )}
        </span>
      </div>
    </button>
  );
}

function EmptySlot({ index }: { index: number }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 text-center px-3 py-4 text-[11px] text-gray-500">
      <div className="font-semibold mb-1">#{index}</div>
      <div>WACHT OP SPELER</div>
    </div>
  );
}

// ---- Queue list ----
function QueueList({ entries }: { entries: QueueEntry[] }) {
  if (!entries.length) {
    return <div className="text-xs text-gray-500 px-1 py-1">Wachtrij is leeg.</div>;
  }

  return (
    <div className="space-y-2">
      {entries.map((q) => (
        <div
          key={q.tiktok_id}
          className="rounded-xl bg-white border border-gray-200 shadow-sm px-3 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
        >
          <div className="flex items-center gap-3 text-sm">
            <span className="font-bold text-gray-900">
              #{q.position}
            </span>
            <div className="flex flex-col">
              <span className="font-medium text-gray-900">
                @{q.display_name ?? q.username}
              </span>
              <span className="text-[11px] text-gray-500">
                {q.reason}{" "}
                {q.priorityDelta !== 0 && (
                  <span className="text-[11px] text-[#ff4d4f] font-semibold">
                    (+{q.priorityDelta})
                  </span>
                )}
              </span>
            </div>
            {q.is_vip && (
              <span className="px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-[10px] font-semibold">
                VIP
              </span>
            )}
            {q.is_fan && (
              <span className="px-1.5 py-0.5 rounded-full bg-pink-100 text-pink-700 text-[10px] font-semibold">
                FAN
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1 justify-end text-[10px]">
            <button className="px-2 py-1 rounded-full border border-gray-200 bg-gray-50 hover:bg-gray-100">
              ↑ Promote
            </button>
            <button className="px-2 py-1 rounded-full border border-gray-200 bg-gray-50 hover:bg-gray-100">
              ↓ Demote
            </button>
            <button className="px-2 py-1 rounded-full border border-gray-200 bg-gray-50 hover:bg-gray-100">
              ➜ Arena
            </button>
            <button className="px-2 py-1 rounded-full border border-red-200 text-red-600 bg-red-50 hover:bg-red-100">
              ✕ Verwijder
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Player detail modal (UI skeleton, zonder echte data-koppeling nog) ----
function PlayerDetailModal({
  player,
  onClose,
}: {
  player: ArenaPlayer;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Spelerdetails
            </h3>
            <p className="text-[11px] text-gray-500">
              @{player.display_name ?? player.username}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-800"
          >
            Sluiten
          </button>
        </div>

        {/* Hier later: echte stats uit backend (diamonds_total, bp_total, etc.) */}
        <div className="text-[12px] text-gray-700 space-y-1 mb-3">
          <p>
            Status:{" "}
            <span className="font-semibold">
              {player.status === "alive" ? "Alive" : "Eliminated"}
            </span>
          </p>
          <p>
            Ronde diamonds:{" "}
            <span className="font-mono font-semibold">
              {player.diamonds.toLocaleString("nl-NL")}
            </span>
          </p>
        </div>

        <div className="border-t border-gray-200 pt-3 mt-2">
          <p className="text-[11px] font-semibold text-gray-800 mb-2">
            Overrides (per speler)
          </p>
          <div className="flex flex-col gap-2 text-[11px]">
            <TogglePillSimple label="Queue AAN/UIT" />
            <TogglePillSimple label="Boosters AAN/UIT" />
            <TogglePillSimple label="Twists AAN/UIT" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TogglePillSimple({ label }: { label: string }) {
  return (
    <button className="inline-flex items-center justify-between w-full px-3 py-1.5 rounded-full border border-gray-200 bg-gray-50 hover:bg-gray-100 text-[11px]">
      <span>{label}</span>
      <span className="w-7 h-3 rounded-full bg-gray-300 relative">
        <span className="absolute left-0.5 top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow" />
      </span>
    </button>
  );
}
