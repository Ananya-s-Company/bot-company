"use server";

import { redirect } from "next/navigation";
import { SIGN_IN_FAILED, getAuth, readSessionId, requestIp, sameOrigin, setSessionCookie, throttledMessage } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth/http";

export interface SignInState {
  error?: string;
}

// Public by design (it is the login). Never logs or echoes submitted secrets.
export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  if (!(await sameOrigin())) return { error: SIGN_IN_FAILED };
  const result = await getAuth().login({
    username: String(form.get("username") ?? ""),
    password: String(form.get("password") ?? ""),
    code: String(form.get("code") ?? ""),
    ip: await requestIp(),
    presentedSessionId: await readSessionId(),
  });
  if (!result.ok) return { error: result.reason === "throttled" ? throttledMessage(result.retryAfterMs) : SIGN_IN_FAILED };
  await setSessionCookie(result.sessionId, result.maxAgeMs);
  if (result.kind === "enrol") redirect("/enroll");
  if (result.usedRecoveryCode) redirect("/account?recovery=used");
  redirect(safeNextPath(form.get("next")));
}
