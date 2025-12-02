import { ReactNode } from "react";
import clsx from "clsx";

type PanelProps = {
  children: ReactNode;
  className?: string;
  variant?: "default" | "danger" | "success" | "warning" | "reverse";
};

export function Panel({ children, className, variant = "default" }: PanelProps) {
  const variantStyles = {
    default: "border-white/5 bg-[#0c0c11]/80",
    danger: "border-red-500/40 bg-red-900/10",
    success: "border-emerald-500/40 bg-emerald-900/10",
    warning: "border-yellow-500/40 bg-yellow-900/10",
    reverse: "border-purple-500/40 bg-purple-900/10",
  };

  return (
    <div
      className={clsx(
        "rounded-2xl p-4 border backdrop-blur shadow-[0_0_12px_rgba(0,0,0,0.45)]",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("text-lg font-semibold mb-3 tracking-wide", className)}>
      {children}
    </div>
  );
}

export function PanelSectionTitle({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
      {children}
    </div>
  );
}

export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}
