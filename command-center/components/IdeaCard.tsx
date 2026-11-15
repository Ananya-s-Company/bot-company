import Link from "next/link";
import type { FieldMeta, Idea } from "@/lib/data/types";
import { PENDING, displayValue, formatCost, formatPayback, formatSales, formatTime, riskLabel } from "@/lib/format";
import { toPlainText } from "@/lib/sanitize";
import { RiskBadge } from "./RiskBadge";
import { SafeMarkdown } from "./SafeMarkdown";

// All bot/owner text goes through the BR-18 sanitizer: SafeMarkdown for visible text,
// toPlainText for attributes. Missing values show "Pending", a real 0 shows 0.

function Row({ label, value, markdown, tip, edited }: { label: string; value: string; markdown?: boolean; tip?: string; edited?: string }) {
  const pending = value === PENDING;
  return (
    <div className="flex justify-between gap-2 text-sm">
      <dt className="text-subtle">{label}</dt>
      <dd className="text-right" title={tip}>
        {pending ? (
          <span className="text-subtle italic">{PENDING}</span>
        ) : markdown ? (
          <SafeMarkdown inline>{value}</SafeMarkdown>
        ) : (
          <span>{value}</span>
        )}
        {edited && <span className="ml-1 text-xs text-primary">({edited})</span>}
      </dd>
    </div>
  );
}

export function IdeaCard({ idea, meta }: { idea: Idea; meta: Record<string, FieldMeta> }) {
  const payback = formatPayback(idea);
  const edited = (f: string) => (meta[f]?.actor_kind === "owner" ? meta[f]!.label : undefined);
  const riskMeta = meta.risk_rating;
  const riskHistory = riskMeta
    ? `Previously ${riskLabel((riskMeta.old_value as Idea["risk_rating"]) ?? null)}, changed ${formatTime(riskMeta.at)}`
    : undefined;
  return (
    <article className="rounded-card border border-line bg-surface p-card shadow-sm">
      <h3 className="font-semibold leading-snug">
        <Link href={`/ideas/${encodeURIComponent(idea.id)}`} className="hover:underline">
          <SafeMarkdown inline links={false}>{idea.name}</SafeMarkdown>
        </Link>
        {edited("name") && <span className="ml-1 text-xs font-normal text-primary">({edited("name")})</span>}
      </h3>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-subtle">
        <span className="rounded-badge bg-primary-soft px-2 py-0.5 text-primary">{idea.stage}</span>
        <span>
          Lead: {displayValue(toPlainText(idea.owning_lead_bot))}
          {edited("owning_lead_bot") && <span className="ml-1 text-primary">({edited("owning_lead_bot")})</span>}
        </span>
      </p>
      <div className="mt-2 flex items-center gap-1">
        <RiskBadge rating={idea.risk_rating} title={riskHistory} />
        {edited("risk_rating") && <span className="text-xs text-primary">({edited("risk_rating")})</span>}
      </div>
      {riskHistory && <p className="mt-1 text-xs text-subtle">{riskHistory}</p>}
      <dl className="mt-2 space-y-1">
        <Row label="Startup cost" value={formatCost(idea.startup_cost_cad)} edited={edited("startup_cost_cad")} />
        <Row
          label="Payback"
          value={payback.text}
          tip={payback.tooltip ? toPlainText(payback.tooltip) : undefined}
          edited={edited("payback_weeks")}
        />
        <Row label="Sales / week needed" value={formatSales(idea.sales_per_week_needed)} edited={edited("sales_per_week_needed")} />
        <Row label="Next step" value={displayValue(idea.next_step)} markdown edited={edited("next_step")} />
      </dl>
      <p className="mt-2 text-xs text-subtle">Updated {formatTime(idea.updated_at)}</p>
    </article>
  );
}
