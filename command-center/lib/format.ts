import { RISK_LABELS, type Idea, type RiskRating } from "./data/types";

export const DISPLAY_TZ = "America/Toronto"; // BR-14

/** UTC ISO string -> "Nov 15, 2026, 3:04 PM EST" (always with a zone label). */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

const cad = new Intl.NumberFormat("en-US", { style: "currency", currency: "CAD" }); // "CA$45.00"

export const PENDING = "Pending";

/**
 * Display rule for any value: missing (null, undefined, empty text) shows "Pending"; a
 * real 0 shows "0". Never use truthiness (`v || PENDING`) for values: 0 is data.
 */
export function displayValue(v: string | number | null | undefined): string {
  if (v == null) return PENDING;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : PENDING;
  return v.trim() === "" ? PENDING : v;
}

export function formatCost(v: number | null): string {
  return v == null ? PENDING : cad.format(v);
}

export interface Shown {
  text: string;
  tooltip?: string;
}

/** Payback: whole weeks; "n/a" + reason tooltip when it can't be computed; else Pending (CC-10 AC2, CC-13). */
export function formatPayback(i: Pick<Idea, "payback_weeks" | "payback_na_reason">): Shown {
  if (i.payback_weeks != null) return { text: `${Math.round(i.payback_weeks)} wk` };
  if (i.payback_na_reason) return { text: "n/a", tooltip: i.payback_na_reason };
  return { text: PENDING };
}

export function formatSales(v: number | null): string {
  return v == null ? PENDING : String(Math.round(v));
}

export function riskLabel(r: RiskRating | null): string {
  return r ? RISK_LABELS[r] : PENDING;
}
