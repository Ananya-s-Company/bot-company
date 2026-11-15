import type { RiskRating } from "@/lib/data/types";
import { riskLabel } from "@/lib/format";

const STYLE: Record<RiskRating | "P", string> = {
  G: "bg-risk-green-soft text-risk-green",
  A: "bg-risk-amber-soft text-risk-amber",
  R: "bg-risk-red-soft text-risk-red",
  P: "bg-risk-pending-soft text-risk-pending",
};
const MARK: Record<RiskRating | "P", string> = { G: "●", A: "▲", R: "■", P: "○" };

/** Colour is never the only signal: each badge has a text label and a distinct shape (CC-12 AC1). */
export function RiskBadge({ rating, title }: { rating: RiskRating | null; title?: string }) {
  const k = rating ?? "P";
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-medium ${STYLE[k]}`}
    >
      <span aria-hidden>{MARK[k]}</span>
      {riskLabel(rating)}
    </span>
  );
}
