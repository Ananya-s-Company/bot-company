import { requireOwner } from "@/lib/auth";
import { DECISION_STATUSES, getData } from "@/lib/data";

export const dynamic = "force-dynamic";

// Placeholder target for CC-02 AC2. The real Decisions inbox is epic E3 (a later run).
export default async function DecisionsPlaceholder({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  await requireOwner(`/decisions${status ? `?status=${encodeURIComponent(status)}` : ""}`); // AC1
  // Never echo raw query input: only a known status is shown.
  const filter = (DECISION_STATUSES as readonly string[]).includes(status ?? "") ? status : "none";
  const pending = getData().decisions.countPending();
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Decisions</h1>
      <p className="text-subtle">
        The decisions inbox is not built yet (epic E3). Filter requested: {filter}. Pending now: {pending}.
      </p>
    </div>
  );
}
