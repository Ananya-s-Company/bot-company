// CC-01 server-side guards. Every page, server action and route handler calls one of
// these itself; proxy.ts is only an early, optimistic filter. tests/route-protection.test.ts
// checks that every page, action file and route under app/ uses a guard.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import {
  clientIp,
  forbiddenJson,
  isBackgroundRequest,
  NO_STORE,
  originAllowed,
  parseCookieHeader,
  safeNextPath,
  sessionCookieOptions,
  unauthorizedJson,
  SESSION_COOKIE,
} from "./http";
import { getAuth } from "./runtime";
import type { SessionInfo } from "./service";

export { getAuth } from "./runtime";
export type { SessionInfo } from "./service";

/** The single human account (BR-01). Audit labels use this name ("edited by Ananya", CC-16). */
export interface Owner {
  name: string;
}
export const OWNER: Owner = { name: "Ananya" };

/** AC3: one generic message for every wrong factor. */
export const SIGN_IN_FAILED = "Sign-in failed";

export function throttledMessage(retryAfterMs: number): string {
  const s = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const wait = s < 90 ? `${s} second${s === 1 ? "" : "s"}` : `${Math.ceil(s / 60)} minutes`;
  return `Sign-in failed. Too many attempts: try again in ${wait}.`;
}

export async function readSessionId(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Current session (validated server-side), or null. Deduplicated per request. Prefetches
 * and background requests are checked but do not slide the idle window (ArchitectBot (a)).
 */
export const currentSession = cache(async (): Promise<SessionInfo | null> =>
  getAuth().validateSession(await readSessionId(), { activity: !isBackgroundRequest(await headers()) }),
);

/** Pages: redirect to /login (or /enroll) before any data is read (AC1). */
export async function requireOwner(path: string): Promise<Owner> {
  const s = await currentSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(safeNextPath(path))}`);
  if (s.kind !== "full") redirect("/enroll");
  return OWNER;
}

/** Same-origin check for state-changing requests (CSRF), using the current request headers. */
export async function sameOrigin(method = "POST"): Promise<boolean> {
  return originAllowed(method, await headers(), getAuth().config.allowedOrigins);
}

/** Client IP of the current request, for throttling. */
export async function requestIp(): Promise<string> {
  return clientIp(await headers(), getAuth().config.trustedProxyHops);
}

/**
 * Server actions: the Owner, or null when not signed in (or cross-origin; proxy.ts has
 * already answered those with 403). Callers return a "reauth" result instead of throwing
 * so the form keeps the user's unsaved input.
 */
export async function requireOwnerAction(): Promise<Owner | null> {
  if (!(await sameOrigin())) return null;
  const s = await currentSession();
  return s && s.kind === "full" ? OWNER : null;
}

/** Session for a raw Request (route handlers): reads only the Cookie header. */
export function sessionFromRequest(req: Request, opts: { background?: boolean } = {}): SessionInfo | null {
  const id = parseCookieHeader(req.headers.get("cookie")).get(SESSION_COOKIE);
  return getAuth().validateSession(id, { activity: !opts.background && !isBackgroundRequest(req.headers) });
}

/**
 * Route handlers: 403 on a failed Origin check (ArchitectBot (e)); 401 JSON with no data
 * unless signed in with a full Owner session (AC1). Authorization headers (e.g. bot tokens)
 * are ignored: they never authenticate the UI (BR-02). Polling and SSE requests do not
 * extend the idle window (ArchitectBot (a)); `background: true` marks a whole endpoint
 * (status polls, event streams) as never counting as activity.
 */
export function withOwnerApi<C>(
  handler: (req: Request, ctx: C, session: SessionInfo) => Promise<Response> | Response,
  opts: { background?: boolean } = {},
) {
  return async (req: Request, ctx: C): Promise<Response> => {
    if (!originAllowed(req.method, req.headers, getAuth().config.allowedOrigins)) return forbiddenJson();
    const s = sessionFromRequest(req, opts);
    if (!s || s.kind !== "full") return unauthorizedJson();
    const res = await handler(req, ctx, s);
    res.headers.set("cache-control", NO_STORE);
    return res;
  };
}

export async function setSessionCookie(sessionId: string, maxAgeMs: number): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, sessionId, sessionCookieOptions(maxAgeMs));
}

export async function clearSessionCookies(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", sessionCookieOptions(0));
}
