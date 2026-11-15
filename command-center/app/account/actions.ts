"use server";

import { getAuth, readSessionId, requestIp, requireOwnerAction, throttledMessage } from "@/lib/auth";

export interface RegenerateState {
  error?: string;
  reauth?: boolean;
  /** Shown once (AC3b). The previous set no longer works. */
  recoveryCodes?: string[];
}

/** New recovery codes: needs a signed-in session plus password AND current authenticator code. */
export async function regenerateRecoveryCodes(_prev: RegenerateState, form: FormData): Promise<RegenerateState> {
  if (!(await requireOwnerAction())) return { reauth: true, error: "Your session has ended. Sign in again." };
  const r = await getAuth().regenerateRecoveryCodes({
    sessionId: await readSessionId(),
    password: String(form.get("password") ?? ""),
    code: String(form.get("code") ?? ""),
    ip: await requestIp(),
  });
  if (!r.ok) {
    return { error: r.reason === "throttled" ? throttledMessage(r.retryAfterMs) : "That did not work. Check your password and authenticator code." };
  }
  return { recoveryCodes: r.recoveryCodes };
}
