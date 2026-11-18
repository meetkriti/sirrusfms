// Deterministic (Mock mode) language helpers: reply intent parsing for English /
// Hinglish / Kannada-in-Latin, and complaint classification. Live mode uses the
// LLM as a fallback when these return "unknown" or low confidence.
import type { Priority, TicketCategory } from "../types";

export type ReplyIntent = "done" | "partial" | "not_done" | "yes" | "no" | "skip" | "number" | "greeting" | "unknown";

export interface ParsedReply {
  intent: ReplyIntent;
  confidence: number;
  towers: string[];
  number?: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}.\s-]/gu, " ").replace(/\s+/g, " ").trim();

const DONE = [/^1$/, /\bdone\b/, /\bho ?ga?ya\b/, /\bkar (diya|liya|di)\b/, /\bcomplete(d)?\b/, /\bfinish(ed)?\b/, /kar (diya|liya)/, /\baaytu\b/, /\bmugi(t|y)/, /\bclean(ed)? ho/, /\bok done\b/, /\bcompleted\b/, /\bready\b/, /\bdone sir\b/];
const PARTIAL = [/^2$/, /\bpart(ly|ial)\b/, /thoda baaki/, /\bhalf\b/, /\baadha\b/, /\bswalpa\b/, /\bpending some\b/, /\bsome (floors|areas) left\b/];
const NOT_DONE = [/^3$/, /not done/, /nahi hu(a|aa)/, /\bnahi\b/, /kal kar(enge|ega|unga)/, /\btomorrow\b/, /\blater\b/, /\bleave\b/, /\billa\b/, /aagilla/, /\bnale\b/, /\bcan'?t\b/, /\bcould not\b/, /\bpending\b/];
const YES = [/^yes\b/, /^y$/, /^haan?\b/, /^ha ji/, /\bresolved\b/, /^ok(ay)? (it'?s )?(fine|working)/, /^houdu/];
const NO = [/^no\b/, /^n$/, /^nahi\b/, /not resolved/, /still (not|same)/, /^illa\b/];
const GREET = [/^(good )?(morning|evening|night)( sir| all)?$/, /^(hi|hello|namaste|namaskara)\b/, /^(ok|okay|noted|thanks|thank you|thx)( sir)?$/];

export function extractTowers(text: string): string[] {
  const t = ` ${text.toUpperCase()} `;
  const out = new Set<string>();
  // "Tower A", "A tower", "A B tower", "A and B tower", "A-block", "C wing"
  const re = /\b(?:TOWER|TWR|BLOCK|WING)\s*-?\s*([A-D])\b|\b([A-D])\s*(?:-|\s)?(?:TOWER|BLOCK|WING|TWR)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) out.add((m[1] || m[2]) as string);
  // lists like "A B C tower" / "A and B tower" / "A, B tower"
  const list = /\b((?:[A-D](?:\s*,\s*|\s+and\s+|\s*&\s*|\s+|\s*\/\s*))+[A-D])\s+(?:TOWER|TOWERS|BLOCK|BLOCKS|WING)/g;
  while ((m = list.exec(t))) for (const c of m[1].match(/[A-D]/g) ?? []) out.add(c);
  const listAfter = /\b(?:TOWERS?|BLOCKS?)\s+((?:[A-D](?:\s*,\s*|\s+and\s+|\s*&\s*|\s+|\s*\/\s*))*[A-D])\b/g;
  while ((m = listAfter.exec(t))) for (const c of m[1].match(/\b[A-D]\b/g) ?? []) out.add(c);
  // unit numbers like B-1204 or B1204 imply the tower
  const unit = /\b([A-D])-?(\d{3,4})\b/g;
  while ((m = unit.exec(t))) out.add(m[1]);
  if (/\bALL (TOWERS|BLOCKS)\b/.test(t)) ["A", "B", "C", "D"].forEach((c) => out.add(c));
  return [...out].sort();
}

export function parseReply(raw: string): ParsedReply {
  const s = norm(raw);
  const towers = extractTowers(raw);
  if (!s) return { intent: "unknown", confidence: 0, towers };
  const num = s.match(/^-?\d+(\.\d+)?$/);
  if (num && !["1", "2", "3"].includes(s)) return { intent: "number", confidence: 0.99, towers, number: Number(s) };
  if (/^skip$/.test(s)) return { intent: "skip", confidence: 0.99, towers };
  if (YES.some((r) => r.test(s))) return { intent: "yes", confidence: 0.95, towers };
  if (NO.some((r) => r.test(s)) && s.length < 30) return { intent: "no", confidence: 0.9, towers };
  // Check "not done" before "done", because "not done" contains "done".
  if (NOT_DONE.some((r) => r.test(s))) return { intent: "not_done", confidence: s.length < 40 ? 0.9 : 0.75, towers };
  if (PARTIAL.some((r) => r.test(s))) return { intent: "partial", confidence: 0.85, towers };
  if (DONE.some((r) => r.test(s))) return { intent: "done", confidence: s.length < 40 ? 0.95 : 0.8, towers };
  if (GREET.some((r) => r.test(s))) return { intent: "greeting", confidence: 0.9, towers };
  const anyNum = s.match(/-?\d+(\.\d+)?/);
  if (anyNum && s.length < 25) return { intent: "number", confidence: 0.8, towers, number: Number(anyNum[0]) };
  return { intent: "unknown", confidence: 0.2, towers };
}

export interface Classification {
  category: TicketCategory;
  priority: Priority;
  location_id: string | null;
  confidence: number;
  summary: string;
}

const CATS: { cat: TicketCategory; re: RegExp; p: Priority; urgent?: RegExp }[] = [
  { cat: "Lift", re: /\blift|elevator\b/, p: "P2", urgent: /stuck|trapped|band|fas gaya|not (working|moving)|breakdown/ },
  { cat: "Water Supply", re: /no water|water (not|supply|nahi|illa)|paani nahi|neeru illa|water cut|low pressure/, p: "P1" },
  { cat: "Pest Control", re: /cockroach|mosquito|\brats?\b|pest|termite|snake|dengue/, p: "P3", urgent: /snake/ },
  { cat: "STP/Odour", re: /smell|odou?r|stink|badbu|vaasane|\bstp\b|sewage|drain overflow|blower/, p: "P2", urgent: /overflow|failure|stopped/ },
  { cat: "Security", re: /guard|security|theft|stolen|stranger|intruder|gate open|unknown person/, p: "P2", urgent: /theft|stolen|intruder|fight|breach/ },
  { cat: "Electrical", re: /light|bulb|power|electric|switch|spark|short circuit|lamp|\bdg\b/, p: "P2", urgent: /spark|short circuit|fire|shock/ },
  { cat: "Plumbing", re: /leak|leakage|drip|\btaps?\b|pipe|flush|block(ed|age)|choke/, p: "P2" },
  { cat: "Landscaping", re: /garden|plant|grass|lawn|tree|hedge|leaves|landscap/, p: "P3" },
  { cat: "Housekeeping", re: /dirty|clean|garbage|kasa|dust|cobweb|mop|sweep|washroom|toilet|spit|stain/, p: "P3" },
];

export function guessLocation(text: string): string | null {
  const s = text.toLowerCase();
  if (/club ?house|gym|pool|party hall/.test(s)) return "CLUBHOUSE";
  if (/stp|sewage/.test(s)) return "STP-ROOM";
  if (/basement|parking/.test(s)) return /\b(b2|basement ?2|lower)\b/.test(s) ? "BASE-2" : "BASE-1";
  if (/main gate|gate/.test(s)) return /service gate/.test(s) ? "SERVICE-GATE" : "MAIN-GATE";
  if (/pump/.test(s)) return "PUMP-ROOM";
  if (/garden|lawn|central/.test(s)) return "GARDEN";
  const towers = extractTowers(text);
  if (towers.length) {
    const t = towers[0];
    if (/stair/.test(s)) return `${t}-STAIR`;
    if (/lobby/.test(s)) return `${t}-LOBBY`;
    return `TWR-${t}`;
  }
  return null;
}

export function classifyComplaint(text: string): Classification {
  const s = text.toLowerCase();
  let best: (typeof CATS)[number] | null = null;
  for (const c of CATS) {
    if (c.re.test(s)) {
      best = c;
      break;
    }
  }
  const category = best?.cat ?? "Other";
  let priority: Priority = best?.p ?? "P3";
  if (best?.urgent && best.urgent.test(s)) priority = "P1";
  if (/urgent|emergency|immediately|jaldi/.test(s) && priority === "P3") priority = "P2";
  const location_id = guessLocation(text);
  const confidence = best ? (location_id ? 0.9 : 0.8) : 0.45;
  const summary = text.length > 90 ? text.slice(0, 87) + "…" : text;
  return { category, priority, location_id, confidence, summary };
}
