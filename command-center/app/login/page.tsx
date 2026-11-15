import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { currentSession, getAuth } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth/http";

export const dynamic = "force-dynamic";

// Public page. Shows no company data. There is no sign-up page (BR-01).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNextPath(next);
  const s = await currentSession();
  if (s?.kind === "full") redirect(target);
  if (s?.kind === "enrol") redirect("/enroll");

  const auth = getAuth();
  // Setup hint only on a local deployment, so a hosted site reveals nothing about its state.
  const showSetupHint = !auth.config.hosted && !auth.status().accountExists;
  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {showSetupHint && (
        <p className="rounded-card border border-line bg-surface p-card text-sm">
          No owner account yet. On the host machine run <code>npm run admin:set-password</code>.
        </p>
      )}
      <LoginForm next={target} codeOptional={auth.config.allowPasswordOnly} />
    </div>
  );
}
