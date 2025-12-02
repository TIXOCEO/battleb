import React from "react";

export default function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
      {children}
    </label>
  );
}
