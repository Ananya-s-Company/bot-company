"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "@/app/login/actions";

const input = "w-full rounded-control border border-line bg-surface px-3 py-2";

export function LoginForm({ next, codeOptional }: { next: string; codeOptional: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-4" autoComplete="on">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm">
        <span>Username</span>
        <input name="username" autoComplete="username" required maxLength={64} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required maxLength={1024} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>
          Authenticator code or recovery code{codeOptional ? " (only if 2FA is set up)" : ""}
        </span>
        <input
          name="code"
          autoComplete="one-time-code"
          inputMode="text"
          maxLength={32}
          spellCheck={false}
          placeholder="123456 or xxxxx-xxxxx"
          className={input}
        />
      </label>
      <button disabled={pending} className="w-full rounded-control bg-primary px-4 py-2 text-primary-ink disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
