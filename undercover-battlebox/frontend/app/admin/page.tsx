"use client";

import React from "react";

export default function AdminDashboardPage() {
  return (
    <main className="flex flex-col min-h-screen bg-gray-50 p-4 md:p-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div className="text-2xl font-bold text-[#ff4d4f]">UB</div>
          <h1 className="text-lg md:text-xl font-semibold">
            Undercover BattleBox – Admin
          </h1>
        </div>
        <div className="text-sm text-gray-600">
          <span className="font-semibold text-green-600">Connected as Admin</span>
        </div>
      </header>

      {/* Top Toggles */}
      <section className="w-full flex flex-wrap gap-2 mb-6">
        {["Queue", "Boosters", "Twists", "Ronde: Voorronde", "Debug logs"].map(
          (item) => (
            <span
              key={item}
              className="bg-gray-200 text-gray-800 text-sm px-3 py-1 rounded-full cursor-default"
            >
              {item}
            </span>
          )
        )}
        <span className="ml-auto text-sm text-gray-500">
          Dagreset: <strong>03:00</strong>
        </span>
      </section>

      {/* Arena + Queue */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
        {/* Arena container */}
        <div className="bg-white rounded-2xl shadow p-4 md:p-6 overflow-y-auto">
          <h2 className="text-xl font-semibold mb-1 text-gray-900">
            Arena (huidige ronde)
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Geen ronde • Max 8 deelnemers
          </p>

          {/* Speler grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="bg-gray-100 rounded-lg p-3 flex flex-col justify-center items-center text-sm text-gray-700"
              >
                <span className="font-semibold text-gray-600">#{i + 1}</span>
                <span className="text-gray-800 font-medium">
                  WACHT OP SPELER
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Queue container */}
        <div className="bg-white rounded-2xl shadow p-4 md:p-6 overflow-y-auto">
          <h2 className="text-xl font-semibold mb-1 text-gray-900">Wachtrij</h2>
          <p className="text-sm text-gray-500 mb-4">
            Live queue • promote / demote / direct naar arena
          </p>
          <div className="flex justify-between items-center mb-2 text-sm">
            <span className="text-gray-600">0 spelers</span>
            <span className="text-green-600 font-semibold">Queue: OPEN</span>
          </div>
          <div className="text-gray-500 text-sm italic">
            Wachtrij is leeg.
          </div>
        </div>
      </section>

      {/* Reserve plek voor Log Feed */}
      <section className="mt-6 bg-white rounded-2xl shadow p-4 md:p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Log Feed (komt binnenkort)
        </h2>
        <p className="text-sm text-gray-500">
          Hier verschijnen straks live events, gifts, eliminaties, boosters, etc.
        </p>
      </section>
    </main>
  );
}
