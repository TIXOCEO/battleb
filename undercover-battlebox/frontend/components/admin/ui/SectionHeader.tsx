import React from "react";

export default function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold text-slate-200 tracking-wide uppercase">
        {title}
      </h2>
      {subtitle && (
        <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}
