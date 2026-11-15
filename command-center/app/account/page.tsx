import Link from "next/link";
import { RegenerateCodesForm } from "@/components/RegenerateCodesForm";
import { currentSession, getAuth, requireOwner } from "@/lib/auth";
import { formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Security settings for the single Owner: 2FA status, recovery codes, sign out.
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ recovery?: string }> }) {
  await requireOwner("/account"); // AC1
  const { recovery } = await searchParams;
  const s = (await currentSession())!;
  const st = getAuth().status();
  return (
    <div className="max-w-2xl space-y-section">
      <h1 className="text-2xl font-semibold">Security</h1>
      {recovery === "used" && (
        <p role="status" className="rounded-card border border-line bg-surface p-card text-sm">
          You signed in with a recovery code; it no longer works. {st.unusedRecoveryCodes} left.
          {st.unusedRecoveryCodes <= 3 && " Create a new set below while you still have your authenticator, or ask the host admin to reset 2FA."}
        </p>
      )}
      <section className="space-y-1 text-sm">
        <p>Two-factor sign-in: {st.totpEnrolled ? "on" : "off"}</p>
        <p>Unused recovery codes: {st.unusedRecoveryCodes}</p>
        <p>
          Signed in {formatTime(s.createdAt.toISOString())}. You will be asked to sign in again (including 2FA) by{" "}
          {formatTime(s.absoluteExpiresAt.toISOString())}, or after 12 hours without activity.
        </p>
      </section>
      {st.totpEnrolled ? (
        <section className="space-y-3">
          <h2 className="font-semibold">New recovery codes</h2>
          <p className="text-sm text-subtle">Creating a new set invalidates every old code.</p>
          <RegenerateCodesForm />
        </section>
      ) : (
        <p className="text-sm">
          <Link href="/enroll" className="text-primary underline">
            Set up two-factor sign-in
          </Link>{" "}
          (required before any hosted deployment).
        </p>
      )}
      <p className="text-sm text-subtle">
        Forgotten password or lost authenticator and all recovery codes: run <code>npm run admin:set-password</code> or{" "}
        <code>npm run admin:reset-2fa</code> on the host machine (see README).
      </p>
    </div>
  );
}
