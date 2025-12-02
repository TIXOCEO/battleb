import React from "react";
import clsx from "clsx";

export default function Input({
  value,
  onChange,
  onFocus,
  placeholder,
  className,
  type = "text",
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      onFocus={onFocus}
      placeholder={placeholder}
      className={clsx(
        "w-full bg-[#13161C] border border-[#2A3038] text-slate-200 px-3 py-2 rounded-[4px] text-sm",
        "placeholder:text-slate-500 focus:outline-none focus:ring-0 focus:border-[#4E97FF]",
        className
      )}
    />
  );
}
