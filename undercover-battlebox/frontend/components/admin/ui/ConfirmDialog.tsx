"use client";

import React from "react";
import clsx from "clsx";

interface ConfirmDialogProps {
  open: boolean;
  message: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open,
  message,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center px-4">
      {/* BACKDROP */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>

      {/* MODAL */}
      <div
        className={clsx(
          "relative w-full max-w-sm rounded-lg border border-[#2A3038]",
          "bg-[#1A1D24] shadow-2xl p-6 animate-in fade-in zoom-in-95"
        )}
      >
        <h3 className="text-lg font-bold text-white mb-2">Bevestigen</h3>

        <p className="text-slate-300 text-sm mb-6 whitespace-pre-line">
          {message}
        </p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 transition"
          >
            Annuleer
          </button>

          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 transition shadow-lg"
          >
            Bevestig
          </button>
        </div>
      </div>
    </div>
  );
}
