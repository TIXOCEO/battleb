import React from "react";
import clsx from "clsx";

export default function Badge({
  children,
  color = "default",
}: {
  children: React.ReactNode;
  color?: "default" | "green" | "red" | "yellow" | "blue" | "purple";
}) {
  const styles = {
    default: "bg-[#2A3038] text-slate-300",
    green: "bg-[#2E5E3C] text-[#73D07E]",
    red: "bg-[#5E2E2E] text-[#FF4D4F]",
    yellow: "bg-[#5E532E] text-[#FFE14E]",
    blue: "bg-[#2E405E] text-[#4E97FF]",
    purple: "bg-[#4A2E5E] text-[#9B59B6]",
  };

  return (
    <span
      className={clsx(
        "px-2 py-0.5 rounded-[3px] text-[11px] font-semibold border border-black/20",
        styles[color]
      )}
    >
      {children}
    </span>
  );
}
