import { applyFilters, resetFilters } from "@/app/actions";
import type { BoardFilters } from "@/lib/board";
import { RISK_LABELS, RISK_RATINGS, STAGES } from "@/lib/data/types";
import { toPlainText } from "@/lib/sanitize";

const control = "rounded-control border border-line bg-surface px-2 py-1 text-sm";

export function FilterBar({ filters, owners }: { filters: BoardFilters; owners: string[] }) {
  return (
    <form action={applyFilters} className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1">
        Stage
        <select name="stage" defaultValue={filters.stage} className={control}>
          <option value="">All</option>
          {STAGES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Risk
        <select name="risk" defaultValue={filters.risk} className={control}>
          <option value="">All</option>
          {RISK_RATINGS.map((r) => (
            <option key={r} value={r}>{RISK_LABELS[r]}</option>
          ))}
          <option value="Pending">Pending</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Lead
        <select name="owner" defaultValue={filters.owner} className={control}>
          <option value="">All</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {toPlainText(o)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Sort by
        <select name="sort" defaultValue={filters.sort} className={control}>
          <option value="updated">Last updated</option>
          <option value="cost">Startup cost</option>
          <option value="payback">Payback</option>
        </select>
      </label>
      <label className="flex items-center gap-2 pb-1">
        <input type="checkbox" name="showKilled" defaultChecked={filters.showKilled} /> Show Killed
      </label>
      <button type="submit" className="rounded-control bg-primary px-3 py-1.5 text-primary-ink">Apply</button>
      <button type="submit" formAction={resetFilters} className="rounded-control border border-line px-3 py-1.5">Reset</button>
    </form>
  );
}
