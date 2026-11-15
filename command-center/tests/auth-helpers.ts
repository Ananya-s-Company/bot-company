import { resolveAuthConfig, type AuthConfig } from "../lib/auth/config";
import { createAuth } from "../lib/auth/service";
import { totpAt } from "../lib/auth/totp";
import { createData } from "../lib/data";
import { openDb } from "../lib/data/db";

export const PASSWORD = "correct horse battery staple";
export const USERNAME = "owner";
export const IP = "203.0.113.7";

/** Auth service on a fresh in-memory DB with a controllable clock. */
export function makeAuth(opts: { start?: string; env?: Record<string, string | undefined>; config?: Partial<AuthConfig> } = {}) {
  let t = Date.parse(opts.start ?? "2026-11-15T12:00:00.000Z");
  const db = openDb(":memory:");
  const now = () => new Date(t);
  const config = { ...resolveAuthConfig({ NODE_ENV: "test", ...opts.env }), ...opts.config };
  const auth = createAuth({ db, now, config });
  const data = createData(db, now);
  return {
    db,
    auth,
    data,
    config,
    now,
    advance: (ms: number) => {
      t += ms;
    },
    /** Current TOTP code for a secret at the fake clock. */
    code: (secret: string, offsetSteps = 0) => totpAt(secret, t + offsetSteps * 30_000),
  };
}
export type TestAuth = ReturnType<typeof makeAuth>;

/** Creates the owner and (optionally) enrols 2FA. Leaves the clock on a fresh TOTP step. */
export async function setupOwner(h: TestAuth, opts: { enrol?: boolean } = {}) {
  await h.auth.setPassword(USERNAME, PASSWORD);
  if (opts.enrol === false) return { secret: null, codes: [] as string[], sessionId: null as string | null };
  const r = await h.auth.login({ username: USERNAME, password: PASSWORD, ip: IP });
  // An "enrol" session normally; a "full" password-only session when the local flag is on.
  if (!r.ok || (r.kind !== "enrol" && !h.config.allowPasswordOnly)) throw new Error(`expected an enrolment session, got ${JSON.stringify(r)}`);
  const s = h.auth.validateSession(r.sessionId);
  const e = h.auth.startEnrolment(s)!;
  const done = await h.auth.confirmEnrolment({ sessionId: r.sessionId, code: h.code(e.secret), ip: IP });
  if (!done.ok) throw new Error("enrolment failed");
  h.advance(30_000); // next TOTP step, so a following login is not a replay
  return { secret: e.secret, codes: done.recoveryCodes, sessionId: done.sessionId };
}
