import { IST_OFFSET_MS, MONTHS, WEEKDAYS, weekday } from "./time";

/** Indian digit grouping: 125000 -> 1,25,000 */
export function groupIndian(n: number, decimals = 0): string {
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, dec] = fixed.split(".");
  let out: string;
  if (int.length <= 3) out = int;
  else {
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    out = `${rest},${last3}`;
  }
  return (neg ? "-" : "") + out + (dec ? `.${dec}` : "");
}

export function inr(n: number, decimals = 0): string {
  return `₹${groupIndian(n, decimals)}`;
}

/** Short lakh/crore form, e.g. ₹8.71 L */
export function inrShort(n: number): string {
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return inr(n);
}

/** DD-MM-YYYY from YYYY-MM-DD */
export function dmy(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}-${m}-${y}`;
}

export function dmyFromMs(ms: number): string {
  return dmy(new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10));
}

/** 12-hour clock in IST, e.g. 7:42 AM */
export function time12(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

export function dateTime(ms: number): string {
  return `${dmyFromMs(ms)} ${time12(ms)}`;
}

export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function dayLabel(date: string): string {
  return `${WEEKDAYS[weekday(date)]} ${shortDate(date)}`;
}

export function pct(n: number, d: number, digits = 0): string {
  if (!d) return "–";
  return `${((n / d) * 100).toFixed(digits)}%`;
}

export function duration(ms: number): string {
  const mins = Math.round(Math.abs(ms) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
