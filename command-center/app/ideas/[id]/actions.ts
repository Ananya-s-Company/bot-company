"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/auth";
import { DomainError, STAGES, getData, type Stage } from "@/lib/data";

export interface EditState {
  ok: boolean;
  error?: string;
  field?: string;
  /** Session expired (or cross-origin): nothing was saved; the form keeps the draft and asks to sign in. */
  reauth?: boolean;
}

const text = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string): number | null => {
  const v = text(f, k);
  return v === "" ? null : Number(v);
};

/** CC-16: Owner edits any field; every change is audited as "edited by Ananya". */
export async function saveIdea(id: string, _prev: EditState, form: FormData): Promise<EditState> {
  const owner = await requireOwnerAction(); // CC-01: checked before any data is read or written
  if (!owner) return { ok: false, reauth: true, error: "Your session has ended. Sign in again to save; your changes are kept." };
  const data = getData();
  const risk = text(form, "risk_rating");
  const patch = {
    name: text(form, "name"),
    owning_lead_bot: text(form, "owning_lead_bot"),
    next_step: text(form, "next_step") || null,
    risk_rating: risk === "" ? null : (risk as "G" | "A" | "R"),
    risk_note: text(form, "risk_note") || null,
    startup_cost_cad: num(form, "startup_cost_cad"),
    payback_weeks: num(form, "payback_weeks"),
    sales_per_week_needed: num(form, "sales_per_week_needed"),
    payback_na_reason: text(form, "payback_na_reason") || null,
  };
  if (Object.values(patch).some((v) => typeof v === "number" && Number.isNaN(v))) {
    return { ok: false, error: "Numbers only in the financial fields" };
  }
  const to = text(form, "stage") as Stage;
  try {
    data.ideas.ownerEdit(
      id,
      { kind: "owner", name: owner.name },
      patch,
      (STAGES as readonly string[]).includes(to)
        ? { to, killReason: text(form, "kill_reason"), createApproval: form.get("create_approval") === "on" }
        : undefined,
    );
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message, field: e.field };
    throw e;
  }
  revalidatePath("/");
  revalidatePath(`/ideas/${id}`);
  return { ok: true };
}
