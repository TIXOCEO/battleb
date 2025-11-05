'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type QueueEntry = {
  position: number;
  user: { username: string; badges: string[]; priority: number };
  boost_spots: number;
};

export default function Dashboard() {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [isFinale, setIsFinale] = useState(false);

  useEffect(() => {
    let socket: Socket;

    const connectSocket = () => {
      socket = io();
      socket.on('queue:update', (data) => {
        setQueue(data);
      });
    };

    connectSocket();

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, []);

  const copyInvite = (username: string) => {
    navigator.clipboard.writeText(`@${username}`);
    alert(`Invite @${username} gekopieerd!`);
  };

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <h1 className="text-6xl text-pink-500 mb-8 text-center animate-pulse-neon">
        ADMIN DASHBOARD
      </h1>

      <div className="max-w-6xl mx-auto space-y-8">

        {/* Game Control */}
        <div className="bg-gray-800 p-6 rounded-xl border-2 border-pink-600">
          <h2 className="text-3xl mb-4 text-yellow-400">Game Control</h2>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <label className="flex items-center gap-3 text-xl">
              <input
                type="checkbox"
                checked={isFinale}
                onChange={(e) => setIsFinale(e.target.checked)}
                className="w-6 h-6"
              />
              Finale Modus
            </label>
          </div>

          <div className="flex gap-4">
            <button className="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-lg font-bold text-xl">
              Start Ronde
            </button>
            <button className="bg-yellow-600 hover:bg-yellow-700 px-6 py-3 rounded-lg font-bold text-xl">
              Pauze
            </button>
            <button className="bg-red-600 hover:bg-red-700 px-6 py-3 rounded-lg font-bold text-xl">
              Einde Ronde
            </button>
          </div>
        </div>

        {/* Queue */}
        <div className="bg-gray-800 p-6 rounded-xl border-2 border-purple-600">
          <h2 className="text-3xl mb-4 text-purple-400">Wachtrij</h2>
          <div className="space-y-4">
            {queue.slice(0, 8).map((entry) => (
              <div
                key={entry.user.username}
                className="bg-gradient-to-r from-purple-900 to-pink-900 p-4 rounded-lg flex justify-between items-center"
              >
                <div className="flex items-center gap-4">
                  <span className="text-2xl font-bold">#{entry.position}</span>
                  <span className="text-xl">@{entry.user.username}</span>
                  <span className="text-yellow-400">+{entry.user.priority}</span>
                  {entry.boost_spots > 0 && (
                    <span className="text-cyan-400">[+{entry.boost_spots}]</span>
                  )}
                </div>
                <button
                  onClick={() => copyInvite(entry.user.username)}
                  className="bg-green-600 hover:bg-green-700 px-6 py-2 rounded font-bold"
                >
                  INVITE
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}