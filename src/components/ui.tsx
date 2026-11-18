import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Clock, Loader2, Minus, MoreHorizontal, X, Inbox } from "lucide-react";
import type { TaskStatus } from "../types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className, title, action, id }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <section id={id} className={cx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({ children, onClick, variant = "default", size = "md", disabled, title, className, type = "button" }: { children: ReactNode; onClick?: () => void; variant?: "default" | "primary" | "ghost" | "danger" | "success"; size?: "sm" | "md"; disabled?: boolean; title?: string; className?: string; type?: "button" | "submit" }) {
  const v = {
    default: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    primary: "bg-accent-600 text-white hover:bg-accent-700",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-red-600 text-white hover:bg-red-700",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
  }[variant];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={cx("inline-flex items-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50", size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm", v, className)}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = "slate", className }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" | "violet"; className?: string }) {
  const t = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    blue: "bg-accent-50 text-accent-700 ring-accent-100",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", t, className)}>{children}</span>;
}

export const STATUS_META: Record<string, { label: string; tone: "green" | "amber" | "red" | "slate" | "blue"; icon: ReactNode; cell: string }> = {
  done: { label: "Done", tone: "green", icon: <Check size={11} />, cell: "bg-emerald-500 text-white" },
  done_late: { label: "Late", tone: "amber", icon: <Clock size={11} />, cell: "bg-amber-400 text-amber-950" },
  late: { label: "Late", tone: "amber", icon: <Clock size={11} />, cell: "bg-amber-400 text-amber-950" },
  missed: { label: "Missed", tone: "red", icon: <X size={11} />, cell: "bg-red-500 text-white" },
  scheduled: { label: "Scheduled", tone: "slate", icon: <MoreHorizontal size={11} />, cell: "bg-slate-200 text-slate-600" },
  sent: { label: "Sent", tone: "blue", icon: <MoreHorizontal size={11} />, cell: "bg-sky-200 text-sky-900" },
  in_progress: { label: "In progress", tone: "blue", icon: <Loader2 size={11} />, cell: "bg-sky-300 text-sky-950" },
  pending: { label: "Pending", tone: "blue", icon: <MoreHorizontal size={11} />, cell: "bg-sky-200 text-sky-900" },
  not_applicable: { label: "N/A", tone: "slate", icon: <Minus size={11} />, cell: "bg-slate-100 text-slate-400" },
  na: { label: "N/A", tone: "slate", icon: <Minus size={11} />, cell: "bg-slate-100 text-slate-300" },
};

export function StatusPill({ status }: { status: TaskStatus | string }) {
  const m = STATUS_META[status] ?? STATUS_META.na;
  return (
    <Badge tone={m.tone}>
      {m.icon}
      {m.label}
    </Badge>
  );
}

export function Kpi({ label, value, sub, tone = "slate", to, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "slate" | "green" | "amber" | "red"; to?: string; icon?: ReactNode }) {
  const color = { slate: "text-slate-900", green: "text-emerald-700", amber: "text-amber-700", red: "text-red-700" }[tone];
  const body = (
    <div className="h-full rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-accent-500/50 hover:shadow">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div className={cx("mt-1 text-2xl font-semibold", color)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block" title="Open the underlying records">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6" onClick={onClose}>
      <div className={cx("w-full rounded-xl bg-white shadow-xl", wide ? "max-w-4xl" : "max-w-2xl")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
      <Inbox size={22} className="text-slate-400" />
      <div className="font-medium text-slate-600">{title}</div>
      {children}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={cx("rounded-md px-3 py-1 text-sm", value === t.id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-500">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-500">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </span>
  );
}

export function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/** Tiny markdown: **bold**, bullet lines, line breaks. */
export function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const inline = (s: string, k: number) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <strong key={`${k}-${i}`}>{p.slice(2, -2)}</strong> : <span key={`${k}-${i}`}>{p}</span>));
  lines.forEach((l, i) => {
    if (/^\s*[-•]\s+/.test(l)) list.push(<li key={i}>{inline(l.replace(/^\s*[-•]\s+/, ""), i)}</li>);
    else {
      if (list.length) {
        out.push(<ul key={`u${i}`} className="my-1 list-disc space-y-0.5 pl-5">{list}</ul>);
        list = [];
      }
      if (l.trim()) out.push(<p key={i} className="my-1">{inline(l, i)}</p>);
    }
  });
  if (list.length) out.push(<ul key="uend" className="my-1 list-disc space-y-0.5 pl-5">{list}</ul>);
  return <div className="text-sm leading-relaxed">{out}</div>;
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500", className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("border-b border-slate-100 px-2 py-1.5 align-top text-sm", className)}>{children}</td>;
}

export function SeverityBadge({ s }: { s: "info" | "warning" | "high" | "low" | "medium" }) {
  const tone = s === "high" ? "red" : s === "warning" || s === "medium" ? "amber" : "blue";
  return <Badge tone={tone as "red"}>{s === "high" ? "● High" : s === "warning" ? "▲ Warning" : s === "medium" ? "▲ Medium" : "ℹ " + (s === "low" ? "Low" : "Info")}</Badge>;
}
