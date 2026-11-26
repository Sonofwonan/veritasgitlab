import type React from "react";

export function adminFetch(path: string, adminKey: string, options: RequestInit = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminKey}`,
      "x-admin-key": adminKey,
      ...(options.headers || {}),
    },
  });
}

export type StatusTone = "emerald" | "amber" | "red" | "sky" | "neutral";

export function StatusLabel({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  const styles: Record<StatusTone, { dot: string; text: string }> = {
    emerald: { dot: "bg-emerald-400", text: "text-emerald-300" },
    amber: { dot: "bg-amber-400", text: "text-amber-300" },
    red: { dot: "bg-rose-400", text: "text-rose-300" },
    sky: { dot: "bg-sky-400", text: "text-sky-300" },
    neutral: { dot: "bg-slate-500", text: "text-slate-300" },
  };
  const s = styles[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${s.dot}`} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
