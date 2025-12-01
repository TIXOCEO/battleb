"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { getAdminSocket } from "@/lib/socketClient";

import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  AdminAckResponse,
  AdminSocketOutbound,
  SearchUser,
  PlayerLeaderboardEntry,
  GifterLeaderboardEntry,
} from "@/lib/adminTypes";

/* ============================================
   LOCAL TYPES
============================================ */
type StreamStats = {
  totalPlayers: number;
  totalPlayerDiamonds: number;
  totalHostDiamonds: number;
};

type GameSessionState = {
  active: boolean;
  gameId: number | null;
};

type ConfirmState = {
  message: string;
  onConfirm: () => void;
};

export default function AdminDashboardPage() {
  /* ============================================
     CORE STATE
  ============================================ */
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);

  const [playerLeaderboard, setPlayerLeaderboard] =
    useState<PlayerLeaderboardEntry[]>([]);
  const [gifterLeaderboard, setGifterLeaderboard] =
    useState<GifterLeaderboardEntry[]>([]);

  const [activeLbTab, setActiveLbTab] =
    useState<"players" | "gifters">("players");

  const [gameSession, setGameSession] = useState<GameSessionState>({
    active: false,
    gameId: null,
  });

  const [hostDiamonds, setHostDiamonds] = useState(0);

  /* USER INPUTS */
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  /* TWISTS */
  const [twistUserGive, setTwistUserGive] = useState("");
  const [twistUserUse, setTwistUserUse] = useState("");
  const [twistTargetUse, setTwistTargetUse] = useState("");
  const [twistTypeGive, setTwistTypeGive] = useState("");
  const [twistTypeUse, setTwistTypeUse] = useState("");

  /* AUTOCOMPLETE */
  const [typing, setTyping] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [activeAutoField, setActiveAutoField] = useState<
    null | "main" | "give" | "use" | "target"
  >(null);

  /* CONFIRM POPUP STATE */
  const [confirmData, setConfirmData] = useState<ConfirmState | null>(null);

  const autoRef = useRef<HTMLDivElement | null>(null);

  const openConfirm = (data: ConfirmState) => setConfirmData(data);
  const cancelConfirm = () => setConfirmData(null);

  /* ============================================
     CLICK OUTSIDE AUTOCOMPLETE
  ============================================ */
  useEffect(() => {
    function handler(e: any) {
      if (autoRef.current && !autoRef.current.contains(e.target)) {
        setShowResults(false);
        setActiveAutoField(null);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* ============================================
     SOCKET SETUP
  ============================================ */
  useEffect(() => {
    const socket = getAdminSocket();

    socket.on("updateArena", (data) => setArena(data));
    socket.on("updateQueue", (d) => {
      setQueue(d.entries ?? []);
      setQueueOpen(d.open ?? true);
    });

    socket.on("log", (l) => setLogs((p) => [l, ...p].slice(0, 200)));
    socket.on("initialLogs", (d) => setLogs(d.slice(0, 200)));

    socket.on("streamStats", (s) => setStreamStats(s));
    socket.on("gameSession", (s) => setGameSession(s));

    socket.on("leaderboardPlayers", (rows) => setPlayerLeaderboard(rows));
    socket.on("leaderboardGifters", (rows) => setGifterLeaderboard(rows));

    socket.on("hostDiamonds", (d) => setHostDiamonds(d.total));

    socket.on("round:start", (d) =>
      setStatus(`▶️ Ronde gestart (${d.type}) – ${d.duration}s`)
    );
    socket.on("round:grace", (d) =>
      setStatus(`⏳ Grace periode (${d.grace}s)`)
    );
    socket.on("round:end", () =>
      setStatus("⛔ Ronde beëindigd – eliminatiefase")
    );

    socket.on("connect_error", () =>
      setStatus("❌ Socket verbinding weggevallen")
    );

    return () => {
      socket.removeAllListeners();
    };
  }, []);

  /* ============================================
     INITIAL SNAPSHOT
  ============================================ */
  useEffect(() => {
    const socket = getAdminSocket();

    socket.emit("getInitialSnapshot", {}, (snap: any) => {
      if (!snap) return;

      if (snap.arena) setArena(snap.arena);
      if (snap.queue) {
        setQueue(snap.queue.entries ?? []);
        setQueueOpen(snap.queue.open ?? true);
      }
      if (snap.logs) setLogs(snap.logs.slice(0, 200));
      if (snap.stats) setStreamStats(snap.stats);
      if (snap.gameSession) setGameSession(snap.gameSession);

      if (snap.playerLeaderboard)
        setPlayerLeaderboard(snap.playerLeaderboard);

      if (snap.gifterLeaderboard)
        setGifterLeaderboard(snap.gifterLeaderboard);
    });
  }, []);

  /* ============================================
     RONDE TIMER REALTIME UPDATE
  ============================================ */
  useEffect(() => {
    const t = setInterval(() => {
      setArena((a) => (a ? { ...a } : a));
    }, 1000);

    return () => clearInterval(t);
  }, []);

  /* ============================================
     EMITTER HELPERS (FIXED)
  ============================================ */
  const emitAdmin = (
    event: keyof AdminSocketOutbound,
    payload?: any
  ) => {
    const socket = getAdminSocket();
    setStatus(`Bezig met ${event}...`);

    socket.emit(event, payload ?? {}, (res: AdminAckResponse) => {
      setStatus(
        res?.success ? "✅ Uitgevoerd" : `❌ ${res?.message ?? "Geen antwoord"}`
      );
    });
  };

  const emitAdminWithUser = (
    event: keyof AdminSocketOutbound,
    userTarget?: string
  ) => {
    const uname = (userTarget || username || "").trim();
    if (!uname) return;

    const socket = getAdminSocket();
    const formatted = uname.startsWith("@") ? uname : `@${uname}`;

    setStatus(`Bezig met ${event}...`);
    socket.emit(event, { username: formatted }, (res: AdminAckResponse) => {
      setStatus(res?.success ? "✅ Uitgevoerd" : `❌ ${res?.message}`);
    });
  };

  /* ============================================
     AUTOCOMPLETE SEARCH
  ============================================ */
  useEffect(() => {
    const q = typing.trim().replace(/^@+/, "");
    if (!q || q.length < 2) {
      setSearchResults([]);
      return;
    }

    const socket = getAdminSocket();
    const handle = setTimeout(() => {
      socket.emit(
        "searchUsers",
        { query: q },
        (res: { users: SearchUser[] }) => {
          setSearchResults(res?.users || []);
        }
      );
    }, 250);

    return () => clearTimeout(handle);
  }, [typing]);

  function applyAutoFill(user: SearchUser) {
    if (!user) return;

    const formatted = user.username.startsWith("@")
      ? user.username
      : `@${user.username}`;

    if (activeAutoField === "main") setUsername(formatted);
    if (activeAutoField === "give") setTwistUserGive(formatted);
    if (activeAutoField === "use") setTwistUserUse(formatted);
    if (activeAutoField === "target") setTwistTargetUse(formatted);

    setTyping("");
    setSearchResults([]);
    setShowResults(false);
    setActiveAutoField(null);
  }

  /* ============================================
     HELPERS
  ============================================ */
  const fmt = (n: number | string | undefined | null) =>
    Number(n ?? 0).toLocaleString("nl-NL");

  const players = useMemo(() => arena?.players ?? [], [arena]);
  const arenaStatus = arena?.status ?? "idle";

  const canStartRound =
    !!arena && (arenaStatus === "idle" || arenaStatus === "ended");

  const canStopRound = arenaStatus === "active";
  const canGraceEnd = arenaStatus === "grace";

  const roundProgress = useMemo(() => {
    if (!arena) return 0;
    const now = Date.now();

    if (arena.status === "active") {
      const start = arena.roundStartTime;
      const end = arena.roundCutoff;
      return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
    }

    if (arena.status === "grace") {
      const start = arena.roundCutoff;
      const end = arena.graceEnd;
      return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
    }

    return 0;
  }, [arena]);

  const formatTime = (sec: number) => {
    if (!sec || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const colorForPosition = (p: any) => {
    if (!arena || arena.status === "idle")
      return "bg-gray-50 border-gray-200";

    switch (p.positionStatus) {
      case "immune":
        return "bg-green-100 border-green-300";
      case "danger":
        return "bg-orange-100 border-orange-300";
      case "elimination":
        return "bg-red-200 border-red-400";
      default:
        return "bg-gray-50 border-gray-200";
    }
  };
