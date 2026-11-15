"use client";

import Link from "next/link";
import { useActionState } from "react";
import { regenerateRecoveryCodes, type RegenerateState } from "@/app/account/actions";
import { RecoveryCodeList } from "./RecoveryCodeList";

const input = "w-full rounded-control border border-line bg-surface px-3 py-2";

export function RegenerateCodesForm() {
  const [state, action, pending] = useActionState<RegenerateState, FormData>(regenerateRecoveryCodes, {});
  if (state.recoveryCodes) {
    return (
      <div className="space-y-3">
        <p role="status" className="font-semibold">
          New recovery codes created. Your old codes no longer work.
        </p>
        <RecoveryCodeList codes={state.recoveryCodes} />
      </div>
    );
  }
  return (
    <form action={action} className="max-w-sm space-y-3">
      <label className="flex flex-col gap-1 text-sm">
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required maxLength={1024} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Current 6-digit authenticator code</span>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={input} />
      </label>
      <button disabled={pending} className="rounded-control bg-primary px-4 py-2 text-sm text-primary-ink disabled:opacity-60">
        {pending ? "Creating…" : "Create new recovery codes"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.reauth && (
        <Link href="/login?next=%2Faccount" className="text-sm text-primary underline">
          Sign in again
        </Link>
      )}
    </form>
  );
}
