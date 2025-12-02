import React from "react";
import clsx from "clsx";

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

export default function Panel({ children, className, ...props }: PanelProps) {
  return (
    <div
      {...props}
      className={clsx(
        "rounded-[6px] border border-[#2A3038] bg-[#1C2129]",
        "shadow-[0_2px_10px_rgba(0,0,0,0.45)] p-5",
        "relative overflow-hidden",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[url('/noise.png')]"></div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
