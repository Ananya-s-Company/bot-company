"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmEnrolment, type EnrolState } from "@/app/enroll/actions";
import { RecoveryCodeList } from "./RecoveryCodeList";

const input = "w-full rounded-control border border-line bg-surface px-3 py-2";

/**
 * Rendered at the same position whether or not enrolment is finished, so the recovery
 * codes in client state survive the server refresh that follows the cookie change.
 */
export function EnrolForm({ qrDataUri, secret }: { qrDataUri: string | null; secret: string | null }) {
  const [state, action, pending] = useActionState<EnrolState, FormData>(confirmEnrolment, {});

  if (state.recoveryCodes) {
    return (
      <div className="space-y-4">
        <p role="status" className="font-semibold">Two-factor sign-in is on.</p>
        <RecoveryCodeList codes={state.recoveryCodes} />
        <Link href="/" className="inline-block rounded-control bg-primary px-4 py-2 text-sm text-primary-ink">
          I have saved them, continue
        </Link>
      </div>
    );
  }

  if (!secret || !qrDataUri) {
    return (
      <p>
        Two-factor sign-in is already set up. <Link href="/" className="text-primary hover:underline">Continue</Link>
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>Open your authenticator app and add an account by scanning this code.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- local data URI, generated on this server */}
      <img src={qrDataUri} alt="QR code for your authenticator app" width={200} height={200} className="rounded-card bg-white p-2" />
      <p className="text-sm">
        Can&apos;t scan? Enter this key manually (time-based, 6 digits, 30 seconds):
        <br />
        <code className="break-all font-mono">{secret.replace(/(.{4})/g, "$1 ").trim()}</code>
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span>6-digit code</span>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={input} />
      </label>
      <button disabled={pending} className="rounded-control bg-primary px-4 py-2 text-primary-ink disabled:opacity-60">
        {pending ? "Checking…" : "Turn on two-factor sign-in"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
