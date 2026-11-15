"use server";

import { getAuth, readSessionId, requestIp, sameOrigin, setSessionCookie, throttledMessage } from "@/lib/auth";

export interface EnrolState {
  error?: string;
  /** Shown once, never stored in plain text (AC3b). */
  recoveryCodes?: string[];
}

const BAD_CODE = "That code did not work. Check the time on your phone and try the next code.";

// Guarded by the session itself: auth.confirmEnrolment validates it and requires that 2FA
// is not set up yet.
export async function confirmEnrolment(_prev: EnrolState, form: FormData): Promise<EnrolState> {
  if (!(await sameOrigin())) return { error: BAD_CODE };
  const r = await getAuth().confirmEnrolment({
    sessionId: await readSessionId(),
    code: String(form.get("code") ?? ""),
    ip: await requestIp(),
  });
  if (!r.ok) return { error: r.reason === "throttled" ? throttledMessage(r.retryAfterMs) : BAD_CODE };
  await setSessionCookie(r.sessionId, r.maxAgeMs);
  return { recoveryCodes: r.recoveryCodes };
}
