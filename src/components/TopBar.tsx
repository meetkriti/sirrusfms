import { FastForward, Pause, Play, PlayCircle, RotateCcw, SkipForward, Sparkles, FlaskConical } from "lucide-react";
import { useStore } from "../store";
import { config } from "../config";
import { dayLabel, time12 } from "../lib/format";
import { istDate } from "../lib/time";
import type { RoleId } from "../types";
import { cx } from "./ui";

export default function TopBar() {
  const { now, playing, speed, role, aiMode, aiConfigured, aiModel, setPlaying, setSpeed, advance, jumpTo, setRole, setAiMode, reset, setDemo, demo } = useStore();
  return (
    <header className="no-print flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">PS</div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-slate-900">Paradigm Services · Operations Intelligence</div>
          <div className="text-[11px] text-slate-500">Prototype by Sirrus.ai</div>
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Project
        <select className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800" value="lg" onChange={() => undefined} title="1 of ~100 projects. Multi-project view in the full solution.">
          <option value="lg">Lakeshore Greens · Bengaluru East</option>
          <option disabled>Other projects (1 of ~100; multi-project view in full solution)</option>
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Role
        <select className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800" value={role} onChange={(e) => setRole(e.target.value as RoleId)}>
          {config.hierarchy.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1" title="Simulation clock (IST). Reminders, alerts and escalations fire as it moves.">
        <span className="mr-1 text-xs text-slate-500">Sim clock</span>
        <span className="min-w-[150px] font-mono text-sm font-semibold text-slate-800">
          {dayLabel(istDate(now))} {time12(now)}
        </span>
        <button className="rounded p-1 hover:bg-slate-200" onClick={() => setPlaying(!playing)} title={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <select className="rounded border border-slate-300 bg-white text-xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Simulated minutes per real second">
          {[1, 5, 15, 30].map((s) => (
            <option key={s} value={s}>
              {s} min/s
            </option>
          ))}
        </select>
        <button className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs hover:bg-slate-200" onClick={() => advance(60)} title="Jump +1 hour">
          <FastForward size={13} />
          +1 h
        </button>
        <button className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs hover:bg-slate-200" onClick={() => jumpTo("23:59")} title="Jump to end of day">
          <SkipForward size={13} />
          End of day
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-300" title="All names, numbers and the project are fictional">
          <FlaskConical size={11} className="mr-0.5 inline" />
          Sample data
        </span>
        <div className="flex items-center rounded-lg border border-slate-300 p-0.5 text-xs" title={aiConfigured ? `Live uses ${aiModel}` : "Live needs ANTHROPIC_API_KEY on the server"}>
          <span className="px-1.5 text-slate-500">
            <Sparkles size={12} className="inline" /> AI
          </span>
          {(["mock", "live"] as const).map((m) => (
            <button key={m} onClick={() => setAiMode(m)} className={cx("rounded-md px-2 py-0.5 capitalize", aiMode === m ? (m === "live" ? "bg-violet-600 text-white" : "bg-slate-800 text-white") : "text-slate-600 hover:bg-slate-100", m === "live" && !aiConfigured && "opacity-50")}>
              {m}
            </button>
          ))}
        </div>
        <button onClick={() => setDemo(demo ? null : { step: 0 })} className="flex items-center gap-1 rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700">
          <PlayCircle size={15} />
          {demo ? "Exit demo" : "Start demo"}
        </button>
        <button onClick={() => confirm("Reset all demo changes back to the seeded state?") && reset()} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Reset demo data">
          <RotateCcw size={16} />
        </button>
      </div>
    </header>
  );
}
