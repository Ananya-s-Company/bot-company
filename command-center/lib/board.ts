import { RISK_RATINGS, STAGES, type Idea, type RiskRating, type Stage } from "./data/types";

export const SORTS = ["updated", "cost", "payback"] as const;
export type Sort = (typeof SORTS)[number];

export interface BoardFilters {
  stage: Stage | "";
  risk: RiskRating | "Pending" | "";
  owner: string;
  sort: Sort;
  showKilled: boolean;
}

export const DEFAULT_FILTERS: BoardFilters = { stage: "", risk: "", owner: "", sort: "updated", showKilled: false };
export const FILTER_COOKIE = "cc_board_filters";

/** Tolerant parse of untrusted input (query string, cookie JSON). */
export function parseFilters(raw: Record<string, unknown> | null | undefined): BoardFilters {
  const r = raw ?? {};
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
  return {
    stage: (STAGES as readonly string[]).includes(s("stage")) ? (s("stage") as Stage) : "",
    risk: s("risk") === "Pending" || (RISK_RATINGS as readonly string[]).includes(s("risk")) ? (s("risk") as BoardFilters["risk"]) : "",
    owner: s("owner").slice(0, 100),
    sort: (SORTS as readonly string[]).includes(s("sort")) ? (s("sort") as Sort) : "updated",
    showKilled: r.showKilled === true || r.showKilled === "1" || r.showKilled === "on",
  };
}

const nullsLast = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity);

export function applyFilters(ideas: Idea[], f: BoardFilters): Idea[] {
  const out = ideas.filter(
    (i) =>
      (!f.stage || i.stage === f.stage) &&
      (!f.owner || i.owning_lead_bot === f.owner) &&
      (!f.risk || (f.risk === "Pending" ? i.risk_rating == null : i.risk_rating === f.risk)),
  );
  if (f.sort === "cost") out.sort((a, b) => nullsLast(a.startup_cost_cad, b.startup_cost_cad));
  else if (f.sort === "payback") out.sort((a, b) => nullsLast(a.payback_weeks, b.payback_weeks));
  else out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return out;
}
