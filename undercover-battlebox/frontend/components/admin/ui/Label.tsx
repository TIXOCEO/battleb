import React from "react";
import clsx from "clsx";

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children: React.ReactNode;
  className?: string;
}

export default function Label({ children, className, ...props }: LabelProps) {
  return (
    <label
      {...props}
      className={clsx(
        "block text-xs uppercase tracking-wide font-semibold",
        "text-slate-400 mb-1",
        className
      )}
    >
      {children}
    </label>
  );
}
