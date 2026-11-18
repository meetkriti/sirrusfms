// UI-level actions shared by pages and the guided demo.
import { useStore } from "./store";
import * as ai from "./ai/client";
import { applyEvent, emailsToRaw, mapCandidate, parseWhatsAppExport, threadMessages } from "./engine/extract";
import { recordReading } from "./engine/meters";
import type { RawMessage } from "./types";

export async function importMessages(waText: string | null, emailsJson: unknown[] | null) {
  const st = useStore.getState();
  const db = st.db!;
  const start = db.rawMessages.length;
  const raw: RawMessage[] = [];
  if (waText) raw.push(...parseWhatsAppExport(waText, start));
  if (emailsJson) raw.push(...emailsToRaw(emailsJson as never, start));
  // De-duplicate on sender + timestamp + text so re-importing is harmless.
  const seen = new Set(db.rawMessages.map((m) => `${m.sender}|${m.timestamp}|${m.text}`));
  const fresh = raw.filter((m) => !seen.has(`${m.sender}|${m.timestamp}|${m.text}`));
  if (!fresh.length) {
    st.notify("Nothing new to import (messages already imported).");
    return { messages: 0, events: 0 };
  }
  db.rawMessages.push(...fresh);
  const threads = threadMessages(fresh);
  st.setBusy(`Extracting ${threads.length} threads (${st.aiMode === "live" ? "Claude" : "mock rules"})…`);
  try {
    const results = await ai.extractThreads(st.aiMode, threads, (n) => useStore.getState().setBusy(`Extracting… ${n}/${threads.length} threads`));
    const rawById = new Map(db.rawMessages.map((m) => [m.id, m]));
    let events = 0;
    st.mutate((w) => {
      for (const r of results)
        for (const c of r.candidates) {
          const ev = mapCandidate(w, r.thread, c, st.aiMode);
          if (r.failed) {
            ev.review_status = "needs_review";
            ev.note = `AI extraction failed after one retry (${r.failed}); routed to human review.`;
          }
          w.db.extracted.push(ev);
          events++;
          if (ev.review_status === "auto_accepted") applyEvent(w, ev, rawById);
        }
    });
    st.notify(`Imported ${fresh.length} messages → ${events} structured events.`);
    return { messages: fresh.length, events };
  } finally {
    useStore.getState().setBusy(null);
  }
}

export async function importSampleMessages() {
  const [wa, em] = await Promise.all([fetch("/data/whatsapp_export.txt").then((r) => r.text()), fetch("/data/emails.json").then((r) => r.json())]);
  return importMessages(wa, em);
}

export async function processMeterPhotos(photos: string[], capturedBy = "upload") {
  const st = useStore.getState();
  st.setBusy(`Reading ${photos.length} meter photos (${st.aiMode === "live" ? "Claude vision" : "mock labels"})…`);
  try {
    const out = [];
    for (const p of photos) {
      const ex = await ai.readMeterPhoto(useStore.getState().aiMode, p, st.meterLabels);
      let res: ReturnType<typeof recordReading> | null = null;
      st.mutate((w) => {
        res = recordReading(w, ex, { photo: p, captured_by: capturedBy, engine: ex.engine });
      });
      out.push(res!);
    }
    st.notify(`${photos.length} meter photos processed.`);
    return out;
  } finally {
    useStore.getState().setBusy(null);
  }
}

export function sampleMeterPhotos() {
  return useStore.getState().meterLabels.map((l) => `/samples/meters/${l.file}`);
}
