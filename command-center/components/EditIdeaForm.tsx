"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveIdea, type EditState } from "@/app/ideas/[id]/actions";
import { applyDraft, clearDraft, loadDraft, saveDraft, serializeForm, type Draft } from "@/lib/client/draft";
import { RISK_LABELS, RISK_RATINGS, STAGES, type Idea } from "@/lib/data/types";

const input = "w-full rounded-control border border-line bg-surface px-2 py-1.5 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-subtle">{label}</span>
      {children}
    </label>
  );
}

export function EditIdeaForm({ idea }: { idea: Idea }) {
  const draftKey = `idea-edit:${idea.id}`;
  const formRef = useRef<HTMLFormElement>(null);
  const lastInput = useRef<Draft | null>(null);
  const [restored, setRestored] = useState(false);
  const [state, action, pending] = useActionState<EditState, FormData>(async (prev, fd) => {
    const input = serializeForm(fd);
    const r = await saveIdea(idea.id, prev, fd);
    if (r.ok) {
      clearDraft(draftKey);
      lastInput.current = null;
    } else {
      // React resets the form after an action; keep what the Owner typed.
      lastInput.current = input;
      if (r.reauth) saveDraft(draftKey, input); // survives the trip to /login and back
    }
    return r;
  }, { ok: false });

  // After a failed save (validation error or expired session), put the input back.
  useEffect(() => {
    if (!state.ok && lastInput.current && formRef.current) applyDraft(formRef.current, lastInput.current);
  }, [state]);

  // Returning from re-authentication: restore the saved draft once.
  useEffect(() => {
    const d = loadDraft(draftKey);
    if (d && formRef.current) {
      applyDraft(formRef.current, d);
      setRestored(true);
    }
  }, [draftKey]);

  const v = (n: number | null) => (n == null ? "" : String(n));
  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2">
      {restored && !state.ok && !state.reauth && (
        <p role="status" className="text-sm text-primary sm:col-span-2">
          Your unsaved changes were restored. Review them and select Save changes.
        </p>
      )}
      <Field label="Name">
        <input name="name" defaultValue={idea.name} required className={input} />
      </Field>
      <Field label="Owning lead bot">
        <input name="owning_lead_bot" defaultValue={idea.owning_lead_bot} required className={input} />
      </Field>
      <Field label="Stage">
        <select name="stage" defaultValue={idea.stage} className={input}>
          {STAGES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="Kill reason (required when moving to Killed)">
        <input name="kill_reason" defaultValue={idea.kill_reason ?? ""} className={input} />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="create_approval" />
        Moving to Approved/Building: create and approve a decision for this move now
      </label>
      <Field label="Risk rating">
        <select name="risk_rating" defaultValue={idea.risk_rating ?? ""} className={input}>
          <option value="">Pending</option>
          {RISK_RATINGS.map((r) => (
            <option key={r} value={r}>{RISK_LABELS[r]}</option>
          ))}
        </select>
      </Field>
      <Field label="Risk note">
        <input name="risk_note" defaultValue={idea.risk_note ?? ""} className={input} />
      </Field>
      <Field label="Startup cost (CAD)">
        <input name="startup_cost_cad" type="number" step="0.01" min="0" defaultValue={v(idea.startup_cost_cad)} className={input} />
      </Field>
      <Field label="Payback (weeks)">
        <input name="payback_weeks" type="number" step="1" min="0" defaultValue={v(idea.payback_weeks)} className={input} />
      </Field>
      <Field label="Payback n/a reason (shown as tooltip)">
        <input name="payback_na_reason" defaultValue={idea.payback_na_reason ?? ""} className={input} />
      </Field>
      <Field label="Sales per week needed">
        <input name="sales_per_week_needed" type="number" step="1" min="0" defaultValue={v(idea.sales_per_week_needed)} className={input} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Next step">
          <input name="next_step" defaultValue={idea.next_step ?? ""} className={input} />
        </Field>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={pending} className="rounded-control bg-primary px-4 py-2 text-sm text-primary-ink disabled:opacity-60">
          {pending ? "Saving…" : "Save changes"}
        </button>
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state.reauth && (
          <Link href={`/login?next=${encodeURIComponent(`/ideas/${idea.id}`)}`} className="text-sm text-primary underline">
            Sign in again
          </Link>
        )}
        {state.ok && <p role="status" className="text-sm text-risk-green">Saved</p>}
      </div>
    </form>
  );
}
