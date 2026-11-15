import { getData } from "@/lib/data";

export const dynamic = "force-dynamic";

// Placeholder target for CC-02 AC2. The real Decisions inbox is epic E3 (a later run).
export default async function DecisionsPlaceholder({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const pending = getData().decisions.countPending();
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Decisions</h1>
      <p className="text-subtle">
        The decisions inbox is not built yet (epic E3). Filter requested: {status ?? "none"}. Pending now: {pending}.
      </p>
    </div>
  );
}
