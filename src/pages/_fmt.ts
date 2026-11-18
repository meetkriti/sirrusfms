import { dmy as dmyDate, dmyFromMs } from "../lib/format";
import { monthLabel } from "../lib/time";

export const dmy = (ms: number) => dmyFromMs(ms);
export const dmyD = dmyDate;
export const monthLabelShort = (m: string) => monthLabel(m, false);
