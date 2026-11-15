import Link from "next/link";
import { notFound } from "next/navigation";
import { EditIdeaForm } from "@/components/EditIdeaForm";
import { IdeaCard } from "@/components/IdeaCard";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import { requireOwner } from "@/lib/auth";
import { getData } from "@/lib/data";
import { displayValue, formatTime } from "@/lib/format";
import { toPlainText } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireOwner(`/ideas/${encodeURIComponent(id)}`); // AC1: before any data is read
  const data = getData();
  const idea = data.ideas.get(id);
  if (!idea) notFound();
  const { audit, stageChanges } = data.ideas.history(id);

  return (
    <div className="space-y-section">
      <Link href="/" className="text-sm text-primary hover:underline">← Board</Link>
      <h1 className="text-2xl font-semibold">
        <SafeMarkdown inline links={false}>{idea.name}</SafeMarkdown>
      </h1>
      <div className="grid gap-section lg:grid-cols-[22rem_1fr]">
        <IdeaCard idea={idea} meta={data.ideas.fieldMeta(id)} />
        <section className="rounded-card border border-line bg-surface p-card">
          <h2 className="mb-3 font-semibold">Edit (audited as “edited by Ananya”)</h2>
          <EditIdeaForm idea={idea} />
        </section>
      </div>
      <section>
        <h2 className="mb-2 font-semibold">Stage history</h2>
        <ul className="space-y-1 text-sm">
          {stageChanges.map((s) => (
            <li key={s.id}>
              {s.from_stage} → {s.to_stage} · {toPlainText(s.by_bot)} · {formatTime(s.at)}
              {s.decision_id ? ` · decision #${s.decision_id}` : ""}
            </li>
          ))}
          {stageChanges.length === 0 && <li className="text-subtle">No stage changes yet.</li>}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Audit history</h2>
        <ul className="space-y-1 text-sm">
          {audit.map((a) => (
            <li key={a.id}>
              <code>{a.field}</code>: {displayValue(toPlainText(a.old_value))} → {displayValue(toPlainText(a.new_value))} ·{" "}
              {toPlainText(a.label)} · {formatTime(a.at)}
            </li>
          ))}
          {audit.length === 0 && <li className="text-subtle">No changes yet.</li>}
        </ul>
      </section>
    </div>
  );
}
