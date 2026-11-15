import Link from "next/link";
import { STAGES, type HomeSummary } from "@/lib/data/types";

/** CC-02: what needs me, at the top of Home. */
export function SummaryStrip({ s }: { s: HomeSummary }) {
  return (
    <section aria-label="What needs you" className="rounded-card border border-line bg-surface p-card">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <div>
          {s.pendingDecisions > 0 ? (
            <Link href="/decisions?status=Pending" className="text-lg font-semibold text-primary hover:underline">
              {s.pendingDecisions} pending decision{s.pendingDecisions === 1 ? "" : "s"}
            </Link>
          ) : (
            <p className="text-lg font-semibold">Nothing needs you right now</p>
          )}
        </div>
        <Stat label="Rated Red" value={s.redIdeas} />
        <Stat label="Updates since last visit" value={s.updatesSinceLastVisit} />
        <Stat label="Total ideas" value={s.totalIdeas} />
      </div>
      <ul className="mt-3 flex flex-wrap gap-2 text-xs">
        {STAGES.map((st) => (
          <li key={st} className="rounded-badge bg-canvas px-2 py-1">
            {st}: <strong>{s.stageCounts[st]}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-subtle">{label}</div>
    </div>
  );
}
