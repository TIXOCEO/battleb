'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type QueueEntry = {
  position: number;
  user: {
    username: string;
    badges: string[];
    priority: number;
  };
  boost_spots: number;
};

export default function QueueOverlay() {
  const [queue, setQueue] = useState<QueueEntry[]>([]);

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

  return (
    <div className="min-h-screen bg-black p-8">
      <h1 className="text-7xl text-pink-500 mb-12 text-center animate-pulse-neon">
        QUEUE
      </h1>

      <div className="max-w-4xl mx-auto space-y-6">
        {queue.length === 0 ? (
          <p className="text-gray-500 text-3xl text-center">Wacht op !join...</p>
        ) : (
          queue.map((entry) => (
            <div
              key={entry.user.username}
              className="bg-gradient-to-r from-purple-900 to-pink-900 p-6 rounded-2xl border-4 border-pink-600 shadow-2xl shadow-pink-500/50 flex justify-between items-center"
            >
              <div className="flex items-center gap-6">
                <span className="text-5xl font-bold text-white">
                  #{entry.position}
                </span>
                <span className="text-4xl font-bold">@{entry.user.username}</span>

                <div className="flex gap-2">
                  {entry.user.badges.includes('superfan') && (
                    <span className="bg-yellow-600 text-yellow-100 px-3 py-1 rounded text-sm font-bold">
                      SUPERFAN
                    </span>
                  )}
                  {entry.user.badges.includes('fanclub') && (
                    <span className="bg-blue-600 text-blue-100 px-3 py-1 rounded text-sm font-bold">
                      FANCLUB
                    </span>
                  )}
                  {entry.user.badges.includes('vip') && (
                    <span className="bg-purple-600 text-purple-100 px-3 py-1 rounded text-sm font-bold">
                      VIP
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-6 text-3xl">
                <span className="text-yellow-400 font-bold">
                  +{entry.user.priority}
                </span>
                {entry.boost_spots > 0 && (
                  <span className="text-cyan-400 font-bold">
                    [+{entry.boost_spots}]
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
