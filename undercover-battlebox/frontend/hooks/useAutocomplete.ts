"use client";

import { useState, useEffect, useRef } from "react";
import { getAdminSocket } from "@/lib/socketClient";

export type AutoField = "main" | "give" | "use" | "target" | null;

interface UseAutocompleteReturn {
  typing: string;
  setTyping: (v: string) => void;

  show: boolean;
  setShow: (v: boolean) => void;

  results: any[];
  activeField: AutoField;
  setActiveField: (f: AutoField) => void;

  containerRef: React.RefObject<HTMLDivElement>;
  apply: (user: any) => void;
}

/**
 * UNIVERSAL AUTOCOMPLETE ENGINE
 *
 * Supports multiple fields:
 *  - main
 *  - give
 *  - use
 *  - target
 *
 * Panels just call:
 *  setActiveField("give")
 *  setTyping(currentValue)
 * 
 * And when selecting a user:
 *  apply(user)
 *
 */
export function useAutocomplete(
  setValueForField: (field: AutoField, value: string) => void
): UseAutocompleteReturn {
  const containerRef = useRef<HTMLDivElement>(null);

  const [typing, setTyping] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [activeField, setActiveField] = useState<AutoField>(null);
  const [show, setShow] = useState(false);

  // Close autocomplete on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShow(false);
        setActiveField(null);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Trigger socket search
  useEffect(() => {
    const q = typing.trim().replace(/^@+/, "");

    if (!q || q.length < 2) {
      setResults([]);
      return;
    }

    const socket = getAdminSocket();
    const timeout = setTimeout(() => {
      socket.emit(
        "searchUsers",
        { query: q },
        (res: { users: any[] }) => setResults(res?.users || [])
      );
    }, 250);

    return () => clearTimeout(timeout);
  }, [typing]);

  // Accept user selection
  function apply(user: any) {
    if (!user) return;

    const formatted = user.username.startsWith("@")
      ? user.username
      : `@${user.username}`;

    setValueForField(activeField, formatted);

    setTyping("");
    setResults([]);
    setShow(false);
    setActiveField(null);
  }

  return {
    typing,
    setTyping,
    show,
    setShow,
    results,
    activeField,
    setActiveField,
    containerRef,
    apply,
  };
}
