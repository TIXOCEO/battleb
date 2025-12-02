import React from "react";
import clsx from "clsx";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export default function Input({
  className,
  ...props
}: InputProps) {
  return (
    <input
      {...props}
      className={clsx(
        "w-full bg-[#13161C] border border-[#2A3038] text-slate-200",
        "px-3 py-2 rounded-[4px] text-sm",
        "placeholder:text-slate-500",
        "focus:outline-none focus:ring-0 focus:border-[#4E97FF]",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className
      )}
    />
  );
}
