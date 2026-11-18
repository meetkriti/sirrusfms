import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useStore } from "../store";
import { istAt, istDate, addDays } from "../lib/time";
import { importSampleMessages, processMeterPhotos, sampleMeterPhotos } from "../actions";
import type { RoleId } from "../types";

interface Step {
  title: string;
  route: string | (() => string);
  role: RoleId;
  phone?: string;
  caption: string;
  actions?: { label: string; run: () => void | Promise<unknown> }[];
}

const prevMonth = () => addDays(`${istDate(useStore.getState().now).slice(0, 7)}-01`, -1).slice(0, 7);
const at = (hhmm: string) => () => {
  const s = useStore.getState();
  if (s.now < istAt(istDate(s.now), hhmm)) s.jumpTo(hhmm);
};

export const STEPS: Step[] = [
  {
    title: "1 · Before: the WhatsApp group and emails",
    route: "/messages?tab=raw", role: "fm", phone: "sup_hk",
    caption: "Today, Lakeshore Greens runs on a site WhatsApp group and emailed inspection reports: about 300 messages in two weeks, mostly greetings, 'ok' and photos. From this alone, nobody can say what was done, where, or on time.",
  },
  {
    title: "2 · Structured WhatsApp workflow",
    route: "/tasks", role: "fm", phone: "sup_hk",
    caption: "At 7:30 AM the bot sent Ravi (Housekeeping Supervisor) his staircase checklists on WhatsApp. No new app. In the phone, tap '1 Done' on the Tower A prompt (or type 'A tower ho gaya sir'), then send a photo. Today's board updates immediately.",
    actions: [{ label: "Move clock to 07:35", run: at("07:35") }],
  },
  {
    title: "3 · A missed activity: reminder → alert → escalation",
    route: "/alerts", role: "fm", phone: "fm",
    caption: "Tower C staircase was not done. At 9:00 the bot reminds Ravi (R1). At 9:30 the Supervisor and FM get an alert (R2). Because it has now been missed 3 or more times in 7 days, the Zonal Manager gets a 'recurring miss' alert (R3). Each alert says which rule fired and why.",
    actions: [{ label: "Jump clock to 09:35", run: at("09:35") }],
  },
  {
    title: "4 · A society complaint becomes a ticket and escalates",
    route: "/tickets", role: "zonal", phone: "client_sec",
    caption: "The AOA Secretary reports a stuck lift on WhatsApp. It is classified (Lift, P1, Tower B), gets a ticket number and an owner. If it is not resolved, it escalates L1 → L2 at 30 min → L3 at 2 h → L4 at 4 h, with a full timeline.",
    actions: [
      { label: "Send the complaint", run: () => useStore.getState().sendFromPhone({ text: "Lift in B tower again stuck between 7 and 8 floor. Please check urgently" }) },
      { label: "Advance 2 hours", run: () => useStore.getState().advance(121) },
    ],
  },
  {
    title: "5 · Intelligence layer over existing messages",
    route: "/messages?tab=compare", role: "fm",
    caption: "The same WhatsApp export and emails, read by the AI and turned into structured events, each linked to its source message. Tasks reported in the group (but not in the workflow) are marked done; complaints link to tickets; low-confidence items go to a review queue.",
    actions: [{ label: "Import sample export", run: () => importSampleMessages() }],
  },
  {
    title: "6 · Meter readings",
    route: "/meters", role: "finance", phone: "sup_tech",
    caption: "A technician sends meter photos. Each is read, matched to the unit by serial number, validated (lower than last month, 3× average, zero, low confidence) and exported in the billing format. Watch B-1204 get flagged.",
    actions: [{ label: "Upload 10 sample meter photos", run: () => processMeterPhotos(sampleMeterPhotos()) }],
  },
  {
    title: "7 · Billing inputs for the monthly invoice",
    route: () => `/billing?month=${prevMonth()}`, role: "finance",
    caption: "Security attendance becomes billable man-days (present + approved replacements). Consumables without acknowledgement cannot be billed. Project work is matched to approved quotations with variance. The readiness checklist shows what blocks the invoice.",
  },
  {
    title: "8 · Patterns over 90 days",
    route: "/insights", role: "ops_head",
    caption: "Recurring issues by location and category: Tower B lift (repeat breakdowns, all reaching Zonal level), Tower C staircase on Sundays, night patrol at month end, STP odour after rain. Every number is computed from records; the AI only words it.",
  },
  {
    title: "9 · Ask in plain English (or Hinglish)",
    route: "/ask?q=How%20did%20Tower%20C%20housekeeping%20do%20last%20week%3F", role: "ops_head",
    caption: "Questions are answered from data through tools, with the figures used and links to the records. Ask something not tracked (e.g. 'diesel cost') and it says so.",
  },
  {
    title: "10 · Client monthly service report",
    route: () => `/report?month=${prevMonth()}`, role: "client",
    caption: "A one-page report Paradigm could share with the AOA committee: compliance, attendance vs contract, tickets and resolution time, misses with corrective actions. Neutral and transparent. Print or save as PDF.",
  },
];

export default function DemoGuide() {
  const { demo, setDemo, setRole, setPhoneOwner, busy } = useStore();
  const nav = useNavigate();
  const step = demo ? STEPS[demo.step] : null;

  useEffect(() => {
    if (!step) return;
    setRole(step.role);
    if (step.phone) setPhoneOwner(step.phone);
    nav(typeof step.route === "function" ? step.route() : step.route);
  }, [demo?.step]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!demo || !step) return busy ? <Busy text={busy} /> : null;
  return (
    <>
      {busy && <Busy text={busy} />}
      <div className="no-print fixed bottom-3 left-56 right-[380px] z-40 rounded-xl border border-accent-500/30 bg-white/95 p-3 shadow-xl backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-600">Guided demo · step {demo.step + 1} of {STEPS.length}</div>
            <div className="font-semibold text-slate-900">{step.title}</div>
            <p className="mt-0.5 text-sm text-slate-600">{step.caption}</p>
            {step.actions && (
              <div className="mt-2 flex flex-wrap gap-2">
                {step.actions.map((a) => (
                  <button key={a.label} onClick={() => a.run()} className="rounded-lg border border-accent-500 px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-accent-50">
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button disabled={demo.step === 0} onClick={() => setDemo({ step: demo.step - 1 })} className="rounded-lg border px-2 py-1 disabled:opacity-40" title="Previous">
              <ChevronLeft size={16} />
            </button>
            <button disabled={demo.step === STEPS.length - 1} onClick={() => setDemo({ step: demo.step + 1 })} className="rounded-lg bg-accent-600 px-2 py-1 text-white disabled:opacity-40" title="Next">
              <ChevronRight size={16} />
            </button>
            <button onClick={() => setDemo(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" title="Exit demo">
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Busy({ text }: { text: string }) {
  return <div className="no-print fixed right-4 top-14 z-50 rounded-lg bg-violet-700 px-3 py-1.5 text-sm text-white shadow-lg">{text}</div>;
}
