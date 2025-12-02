"use client";

import { useState, useEffect, useRef } from "react";
import { getAdminSocket } from "@/lib/socketClient";
import type { SearchUser } from "@/lib/adminTypes";

/**
 * Het dashboard verwacht deze velden:
 *
 * searchResults
 * showResults
 * activeAutoField
 * applyAutoFill(user)
 * onAutoFocus(field, value)
 *
 * Dit bestand levert nu exact die API aan.
 */

export type AutoField = "main" | "give" | "use" | "target" | null;

export interface UseAutocompleteReturn {
  searchResults: SearchUser[];
  showResults: boolean;
  activeAutoField: AutoField;

  applyAutoFill: (user: SearchUser) => void;
  onAutoFocus: (field: AutoField, value: string) => void;

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

  // -----------------------------------------------------
  // OUTSIDE CLICK → sluit dropdown
  // -----------------------------------------------------
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

  // -----------------------------------------------------
  // SOCKET SEARCH
  // -----------------------------------------------------
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
        (res: { users: SearchUser[] }) => {
          setSearchResults(res?.users ?? []);
        }
      );
    }, 250);

    return () => clearTimeout(timeout);
  }, [typing]);

  // -----------------------------------------------------
  // Wanneer een field focus krijgt / typed
  // -----------------------------------------------------
  function onAutoFocus(field: AutoField, value: string) {
    setActiveAutoField(field);
    setTyping(value);
    setShowResults(true);
  }

  // -----------------------------------------------------
  // User selecteren uit dropdown
  // -----------------------------------------------------
  function applyAutoFill(user: SearchUser) {
    if (!user) return;

    const formatted = user.username.startsWith("@")
      ? user.username
      : `@${user.username}`;

    setValueForField(activeAutoField, formatted);

    // cleanup
    setTyping("");
    setSearchResults([]);
    setShowResults(false);
    setActiveAutoField(null);
  }

  // -----------------------------------------------------
  // RETURN: exact zoals panels nodig hebben
  // -----------------------------------------------------
  return {
    searchResults,
    showResults,
    activeAutoField,

    applyAutoFill,
    onAutoFocus,

    containerRef,
  };
}
