"use client";

import { useState, useEffect, useRef } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type { SearchUser } from "@/lib/adminTypes";

/**
 * AUTOCOMPLETE HOOK
 * Dit sluit 100% aan op de props die panels verwachten.
 */

export type AutoField = "main" | "give" | "use" | "target" | null;

export interface UseAutocompleteReturn {
  searchResults: SearchUser[];
  showResults: boolean;
  activeAutoField: AutoField;

  applyAutoFill: (u: SearchUser) => void;

  /** <-- Panel expects string, so we cast here */
  onAutoFocus: (field: string, value: string) => void;

  containerRef: React.RefObject<HTMLDivElement>;
}

export function useAutocomplete(
  setValueForField: (field: AutoField, value: string) => void
): UseAutocompleteReturn {
  const containerRef = useRef<HTMLDivElement>(null);

  const [activeAutoField, setActiveAutoField] = useState<AutoField>(null);
  const [typing, setTyping] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowResults(false);
        setActiveAutoField(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Perform search
  useEffect(() => {
    const q = typing.trim().replace(/^@+/, "");

    if (!q || q.length < 2) {
      setSearchResults([]);
      return;
    }

    const socket = getAdminSocket();

    const timeout = setTimeout(() => {
      socket.emit(
        "searchUsers",
        { query: q },
        (res: { users: SearchUser[] }) => setSearchResults(res?.users ?? [])
      );
    }, 250);

    return () => clearTimeout(timeout);
  }, [typing]);

  // Panels call onAutoFocus("main", value)
  const onAutoFocus = (field: string, value: string) => {
    const f = field as AutoField; // <-- CAST naar AutoField (fix build)
    setActiveAutoField(f);
    setTyping(value);
    setShowResults(true);
  };

  // User selected
  function applyAutoFill(user: SearchUser) {
    if (!user) return;

    const formatted = user.username.startsWith("@")
      ? user.username
      : `@${user.username}`;

    setValueForField(activeAutoField, formatted);

    setTyping("");
    setSearchResults([]);
    setShowResults(false);
    setActiveAutoField(null);
  }

  return {
    searchResults,
    showResults,
    activeAutoField,
    applyAutoFill,
    onAutoFocus,
    containerRef,
  };
}
