import { cookies } from "next/headers";
import { FilterBar } from "@/components/FilterBar";
import { IdeaCard } from "@/components/IdeaCard";
import { SummaryStrip } from "@/components/SummaryStrip";
import { FILTER_COOKIE, applyFilters, parseFilters } from "@/lib/board";
import { STAGES } from "@/lib/data/types";
import { getData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = getData();
  // Read the summary first (it compares against the previous visit), then record this visit.
  const summary = data.homeSummary();
  data.visits.touch();

  const jar = await cookies();
  let saved: unknown = null;
  try {
    saved = JSON.parse(jar.get(FILTER_COOKIE)?.value ?? "null");
  } catch {
    saved = null;
  }
  const filters = parseFilters(saved as Record<string, unknown> | null);

  const all = data.ideas.list();
  const shown = applyFilters(all, filters);
  const owners = [...new Set(all.map((i) => i.owning_lead_bot))].sort();
  const killed = shown.filter((i) => i.stage === "Killed");
  // CC-10 AC4: Killed hidden by default; also shown when the Killed stage filter is chosen.
  const showKilled = filters.showKilled || filters.stage === "Killed";
  const columns = STAGES.filter((s) => s !== "Killed");

  return (
    <div className="space-y-section">
      <SummaryStrip s={summary} />
      <FilterBar filters={filters} owners={owners} />
      {all.length === 0 && <p className="text-subtle">No ideas yet. Run <code>npm run seed</code>.</p>}
      <div className="grid gap-gutter md:grid-cols-2 xl:grid-cols-3">
        {columns.map((stage) => {
          const ideas = shown.filter((i) => i.stage === stage);
          return (
            <section key={stage} aria-label={stage} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-subtle">
                {stage} <span className="font-normal">({ideas.length})</span>
              </h2>
              {ideas.map((i) => (
                <IdeaCard key={i.id} idea={i} meta={data.ideas.fieldMeta(i.id)} />
              ))}
              {ideas.length === 0 && <p className="text-sm text-subtle">None</p>}
            </section>
          );
        })}
        {showKilled ? (
          <section aria-label="Killed" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-subtle">Killed ({killed.length})</h2>
            {killed.map((i) => (
              <IdeaCard key={i.id} idea={i} meta={data.ideas.fieldMeta(i.id)} />
            ))}
            {killed.length === 0 && <p className="text-sm text-subtle">None</p>}
          </section>
        ) : (
          <p className="text-sm text-subtle">
            Killed ideas are hidden ({all.filter((i) => i.stage === "Killed").length}). Use “Show Killed” above.
          </p>
        )}
      </div>
    </div>
  );
}
