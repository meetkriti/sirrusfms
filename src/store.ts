import { create } from "zustand";
import type { DB, RoleId } from "./types";
import { config, resetConfig } from "./config";
import type { World } from "./engine/core";
import { taskTitle } from "./engine/core";
import { advanceTo } from "./engine/sim";
import { SimulatedAdapter } from "./engine/messaging";
import { handleInbound } from "./engine/bot";
import { istAt, istDate, MIN } from "./lib/time";
import * as ai from "./ai/client";
import { recordReading } from "./engine/meters";
import { locationName } from "./engine/core";
import { clearState, loadState, saveState } from "./lib/persist";

interface Saved {
  seedId: string;
  db: DB;
  now: number;
  config: typeof config;
  role: RoleId;
  phoneOwner: string;
}

export interface DemoState {
  step: number;
}

interface State {
  db: DB | null;
  pristine: string | null;
  rev: number;
  now: number;
  playing: boolean;
  speed: number; // simulated minutes per real second
  role: RoleId;
  aiMode: ai.AIMode;
  aiConfigured: boolean;
  aiModel: string;
  phoneOwner: string;
  phoneOpen: boolean;
  demo: DemoState | null;
  meterLabels: ai.MeterLabel[];
  busy: string | null;
  toast: { text: string; at: number } | null;
  error: string | null;

  load: () => Promise<void>;
  reset: () => void;
  mutate: (fn: (w: World) => void) => void;
  advance: (minutes: number) => void;
  jumpTo: (hhmm: string) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  setRole: (r: RoleId) => void;
  setAiMode: (m: ai.AIMode) => void;
  setPhoneOwner: (id: string) => void;
  setPhoneOpen: (o: boolean) => void;
  setDemo: (d: DemoState | null) => void;
  sendFromPhone: (input: { text?: string; buttonId?: string; buttonTitle?: string; photo?: string }) => Promise<void>;
  notify: (text: string) => void;
  setBusy: (b: string | null) => void;
}

export const useStore = create<State>((set, get) => ({
  db: null,
  pristine: null,
  rev: 0,
  now: 0,
  playing: false,
  speed: 5,
  role: "fm",
  aiMode: "mock",
  aiConfigured: false,
  aiModel: "",
  phoneOwner: "sup_hk",
  phoneOpen: true,
  demo: null,
  meterLabels: [],
  busy: null,
  toast: null,
  error: null,

  load: async () => {
    try {
      const [seedRes, labelsRes, status] = await Promise.all([fetch("/data/seed.json"), fetch("/samples/meters/labels.json"), ai.aiStatus()]);
      if (!seedRes.ok) throw new Error("Sample data not found. Run `npm run seed` and reload.");
      const text = await seedRes.text();
      let db = JSON.parse(text) as DB;
      const labels = labelsRes.ok ? await labelsRes.json() : [];
      // Restore the session after an accidental refresh (only if it came from the same seed).
      const saved = await loadState<Saved>();
      let restored: Partial<State> = {};
      if (saved && saved.seedId === db.meta.generated_at) {
        db = saved.db;
        Object.assign(config, saved.config);
        restored = { now: saved.now, role: saved.role, phoneOwner: saved.phoneOwner };
      }
      ai.setAuditSink((e) => {
        const d = get().db;
        if (d) d.audit.push(e);
      });
      set({ db, pristine: text, now: db.meta.sim_start, rev: 1, meterLabels: labels, aiConfigured: status.configured, aiModel: status.model, error: null, ...restored });
      if (restored.now) get().notify("Restored your demo session. Use ↺ in the top bar to start over.");
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  reset: () => {
    const p = get().pristine;
    if (!p) return;
    resetConfig();
    clearState();
    const db = JSON.parse(p) as DB;
    set({ db, now: db.meta.sim_start, rev: get().rev + 1, playing: false, demo: null });
    get().notify("Demo data reset to the seeded state (07:00 today).");
  },

  mutate: (fn) => {
    const { db, now } = get();
    if (!db) return;
    const w: World = { db, now };
    fn(w);
    set({ now: w.now, rev: get().rev + 1 });
  },

  advance: (minutes) => get().mutate((w) => advanceTo(w, w.now + minutes * MIN)),
  jumpTo: (hhmm) =>
    get().mutate((w) => {
      const target = istAt(istDate(w.now), hhmm);
      if (target > w.now) advanceTo(w, target);
    }),
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (s) => set({ speed: s }),
  setRole: (r) => {
    const def = config.hierarchy.roles.find((x) => x.id === r);
    set({ role: r, phoneOwner: def?.phoneOwner ?? get().phoneOwner });
  },
  setAiMode: (m) => {
    if (m === "live" && !get().aiConfigured) {
      get().notify("Live AI needs ANTHROPIC_API_KEY on the server (see README). Staying in Mock mode.");
      return;
    }
    set({ aiMode: m });
  },
  setPhoneOwner: (id) => set({ phoneOwner: id, phoneOpen: true }),
  setPhoneOpen: (o) => set({ phoneOpen: o }),
  setDemo: (d) => set({ demo: d }),
  notify: (text) => set({ toast: { text, at: Date.now() } }),
  setBusy: (b) => set({ busy: b }),

  sendFromPhone: async (input) => {
    const { db, now, phoneOwner, aiMode, meterLabels } = get();
    if (!db) return;
    const w: World = { db, now };
    const wa = new SimulatedAdapter(w);
    const { webhook } = wa.receive(phoneOwner, input);
    set({ rev: get().rev + 1 });
    if (aiMode === "mock" && input.text) ai.mockIntentAudit(input.text);
    await handleInbound(w, webhook, {
      intentFallback:
        aiMode === "live"
          ? (text, task) => ai.intentFallback(text, task ? taskTitle(db, task.template_id, task.location_id) : "a checklist")
          : undefined,
      classify: (text) => ai.classify(aiMode, text),
      onMeterPhoto: async (staffId, photo) => {
        const ex = await ai.readMeterPhoto(aiMode, photo, meterLabels);
        const { reading, meter, how } = recordReading(w, ex, { photo, captured_by: staffId, engine: ex.engine });
        if (!meter) return `⚠️ Could not match this meter (${reading.flags.join(" ")}). Sent to the review queue on the dashboard.`;
        const status = reading.status === "ok" ? "✅ Saved" : reading.status === "rejected" ? "❌ Rejected" : "⚠️ Needs review";
        return `${status}: ${meter.unit} (${meter.meter_id}, matched by ${how}) reading ${reading.value} KL${reading.consumption !== null ? `, consumption ${reading.consumption} KL` : ""}.${reading.flags.length ? ` ${reading.flags.join(" ")}` : ""}${locationName(db, meter.location_id) ? "" : ""}`;
      },
    });
    set({ rev: get().rev + 1 });
  },
}));

/** Subscribe a component to data changes and return the current db. */
export function useDB(): DB {
  useStore((s) => s.rev);
  return useStore.getState().db!;
}

// Save the session (debounced) whenever data, clock or role changes.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useStore.subscribe((s, prev) => {
  if (!s.db || (s.rev === prev.rev && s.now === prev.now && s.role === prev.role)) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const st = useStore.getState();
    if (st.db) saveState({ seedId: st.db.meta.generated_at, db: st.db, now: st.now, config, role: st.role, phoneOwner: st.phoneOwner } satisfies Saved);
  }, 1000);
});
