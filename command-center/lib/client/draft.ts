// Client-side draft preservation (CC-01 edge case): when a session expires mid-action the
// server action returns { reauth: true } and saves nothing; the form's unsaved input is
// kept in sessionStorage (this tab only) and restored after the Owner signs in again.
// Sign out sends Clear-Site-Data: "storage", which wipes drafts (AC6).
// Used by the idea edit form now and by the decision note form in epic E3.

export const DRAFT_PREFIX = "cc-draft:";

export type Draft = Record<string, string>;

/** Text fields only; Next.js internals ($ACTION_*) and files are skipped. */
export function serializeForm(fd: FormData): Draft {
  const out: Draft = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION") || typeof v !== "string") continue;
    out[k] = v;
  }
  return out;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): StorageLike | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export function saveDraft(key: string, draft: Draft, s: StorageLike | null = store()): void {
  try {
    s?.setItem(DRAFT_PREFIX + key, JSON.stringify(draft));
  } catch {
    /* storage full or disabled: the in-memory form still holds the values */
  }
}

export function loadDraft(key: string, s: StorageLike | null = store()): Draft | null {
  try {
    const raw = s?.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string")) as Draft;
  } catch {
    return null;
  }
}

export function clearDraft(key: string, s: StorageLike | null = store()): void {
  try {
    s?.removeItem(DRAFT_PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Put draft values back into a form's uncontrolled fields. */
export function applyDraft(form: HTMLFormElement, draft: Draft): void {
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) || !el.name) continue;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      el.checked = el.type === "checkbox" ? draft[el.name] === (el.value || "on") : draft[el.name] === el.value;
    } else if (el.name in draft && !(el instanceof HTMLInputElement && (el.type === "hidden" || el.type === "file"))) {
      el.value = draft[el.name]!;
    }
  }
}
