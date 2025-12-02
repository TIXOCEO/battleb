import React from "react";
import clsx from "clsx";

type Variant =
  | "default"
  | "primary"
  | "danger"
  | "success"
  | "warning"
  | "info"
  | "ghost";

export default function Button({
  children,
  onClick,
  disabled,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: Variant;
  className?: string;
}) {
  const base =
    "px-4 py-2 rounded-[4px] text-sm font-semibold transition-all active:translate-y-[1px] border";

  const styles: Record<Variant, string> = {
    default:
      "bg-[#1C2129] border-[#2A3038] text-slate-200 hover:bg-[#242A33] hover:border-[#373E49]",
    primary:
      "bg-[#4E97FF] border-[#3375DA] text-white hover:bg-[#3A7EE5] hover:border-[#2F67BF]",
    danger:
      "bg-[#FF4D4F] border-[#D63D40] text-white hover:bg-[#E64546] hover:border-[#BF3738]",
    success:
      "bg-[#73D07E] border-[#5AB465] text-white hover:bg-[#63B86C] hover:border-[#4FA05A]",
    warning:
      "bg-[#FFE14E] border-[#D8C148] text-black hover:bg-[#E6CC45] hover:border-[#C2AA3E]",
    info:
      "bg-[#9B59B6] border-[#8E4FA8] text-white hover:bg-[#8547A0] hover:border-[#7A4094]",
    ghost:
      "bg-transparent border-[#2A3038] text-slate-300 hover:bg-[#242A33] hover:border-[#373E49]",
  };

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        base,
        styles[variant],
        disabled && "opacity-40 cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}
