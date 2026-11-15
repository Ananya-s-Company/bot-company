import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "../data/db";
import { createOwnerAuthRepo, type SessionRow } from "../data/owner-auth";
import type { AuthConfig } from "./config";
import { dummyHash, hashPassword, needsRehash, passwordPolicyError, PASSWORD_MAX_LENGTH, verifyPassword } from "./password";
import { generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode, matchRecoveryCode } from "./recovery";
import { generateTotpSecret, looksLikeTotp, otpauthUri, verifyTotp } from "./totp";

// CC-01 Owner authentication. Pure server logic: no Next.js imports, clock injected.
// Bot credentials (table bot_credentials) are never consulted here, so a bot token can
// never become a UI session (BR-02).

export interface SessionInfo {
  kind: "full" | "enrol";
  mfa: boolean;
  createdAt: Date;
  lastSeenAt: Date;
  /** Latest possible end of this session (absolute limit AC5a, or the enrolment limit). */
  absoluteExpiresAt: Date;
  /** When the session ends if there is no further Owner activity (AC5), capped by the absolute limit. */
  idleExpiresAt: Date;
}

/** Throttled: the attempt was not checked at all. */
export type Throttled = { ok: false; reason: "throttled"; retryAfterMs: number };
export type Failed = { ok: false; reason: "failed" };

export type LoginResult =
  | { ok: true; sessionId: string; kind: "full" | "enrol"; maxAgeMs: number; usedRecoveryCode: boolean }
  | Failed
  | Throttled;
export type EnrolResult = { ok: true; sessionId: string; maxAgeMs: number; recoveryCodes: string[] } | Failed | Throttled;
export type RegenerateResult = { ok: true; recoveryCodes: string[] } | Failed | Throttled;

const ROLLBACK = Symbol("rollback");
const SESSION_ID_RE =/^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
const MAX_USERNAME = 64;
const MAX_CODE = 64;

/** Only the SHA-256 of a session id is stored; the raw id exists only in the cookie. */
export const hashSessionId = (raw: string): string => createHash("sha256").update(raw).digest("hex");
const newSessionId = (): string => randomBytes(32).toString("base64url");
export const normalizeUsername = (u: string): string => u.trim().toLowerCase();
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/** Account-wide backoff after n consecutive failures: base * 2^(n-1), capped (no hard lockout). */
export function backoffDelayMs(n: number, baseMs: number, maxMs: number): number {
  if (n <= 0) return 0;
  return Math.min(baseMs * 2 ** Math.min(n - 1, 30), maxMs);
}

export interface AuthDeps {
  db: Db;
  now: () => Date;
  config: AuthConfig;
}

export function createAuth({ db, now, config }: AuthDeps) {
  const repo = createOwnerAuthRepo(db);
  const iso = (d: Date | number = now()) => new Date(d).toISOString();
  const mfaRequired = !config.allowPasswordOnly;
  const { throttle } = config;

  function createSession(kind: "full" | "enrol", mfa: boolean, t: Date): { sessionId: string; maxAgeMs: number } {
    const sessionId = newSessionId();
    const row: SessionRow = { id_hash: hashSessionId(sessionId), kind, mfa: mfa ? 1 : 0, created_at: iso(t), last_seen_at: iso(t) };
    repo.insertSession(row);
    return { sessionId, maxAgeMs: kind === "full" ? config.absoluteMs : config.enrolMs };
  }

  function pruneSessions(t: Date): void {
    repo.deleteSessionsBefore(iso(t.getTime() - config.idleMs), iso(t.getTime() - config.absoluteMs));
  }

  /**
   * Throttling around ONE verification (password, TOTP, recovery code, enrolment code or
   * regeneration). All of them share this path, so they share one failure counter.
   *
   *  - Per IP (AC4): `ipMaxFailures` (5) failures within `ipWindowMs` (15 min) block that
   *    IP for `ipLockoutMs` (15 min) from the latest one; blocked attempts are not checked.
   *  - Account-wide: exponential backoff after consecutive failures, capped at
   *    `backoffMaxMs`. There is no hard lockout of the Owner; admin:unlock clears both.
   *
   * The attempt is reserved (counted as a failure, backoff advanced) BEFORE any secret is
   * checked, so a burst of parallel requests cannot slip past the limits. A success
   * clears that IP's failures and the account backoff.
   */
  async function attempt<T>(ip: string, check: (t: Date) => Promise<(() => T | null) | null>): Promise<{ ok: true; value: T } | Failed | Throttled> {
    const t = now();
    const tm = t.getTime();
    const reserved = repo.tx((): { id: number } | { retryAfterMs: number } => {
      const b = repo.getBackoff();
      const delay = backoffDelayMs(b.consecutive_failures, throttle.backoffBaseMs, throttle.backoffMaxMs);
      if (b.last_failure_at && delay > 0) {
        const until = Date.parse(b.last_failure_at) + delay;
        if (tm < until) return { retryAfterMs: until - tm };
      }
      // AC4: 5 failures within 15 minutes block this IP for 15 minutes from the latest of
      // them. Blocked attempts are not recorded, so retrying cannot extend the block.
      const fails = repo.failuresSince(ip, iso(tm - throttle.ipWindowMs - throttle.ipLockoutMs)).map((a) => Date.parse(a));
      for (let i = fails.length - 1; i >= throttle.ipMaxFailures - 1; i--) {
        const last = fails[i]!;
        if (tm >= last + throttle.ipLockoutMs) break; // older bursts have expired too
        if (last - fails[i - throttle.ipMaxFailures + 1]! <= throttle.ipWindowMs) {
          return { retryAfterMs: Math.max(1, last + throttle.ipLockoutMs - tm) };
        }
      }
      repo.pruneAttemptsBefore(iso(tm - Math.max(throttle.ipWindowMs + throttle.ipLockoutMs, 24 * 3600_000)));
      const id = repo.insertAttempt(ip, iso(t));
      repo.setBackoff(b.consecutive_failures + 1, iso(t));
      return { id };
    });
    if ("retryAfterMs" in reserved) return { ok: false, reason: "throttled", retryAfterMs: reserved.retryAfterMs };

    let commit: (() => T | null) | null = null;
    try {
      commit = await check(t);
    } catch {
      commit = null;
    }
    let value: T | null = null;
    if (commit) {
      try {
        value = repo.tx(() => {
          const v = commit!();
          if (v === null) throw ROLLBACK; // e.g. concurrent replay: undo any partial writes
          repo.finishAttempt(reserved.id, "success");
          repo.clearFailuresForIp(ip);
          repo.setBackoff(0, null);
          return v;
        });
      } catch (e) {
        if (e !== ROLLBACK) throw e;
      }
    }
    if (value !== null) return { ok: true, value };
    repo.finishAttempt(reserved.id, "failed"); // backoff was already advanced at reservation
    return { ok: false, reason: "failed" };
  }

  async function hashCodes(codes: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const c of codes) out.push(await hashRecoveryCode(c)); // sequential: bounded memory
    return out;
  }

  const auth = {
    config,
    mfaRequired,

    /** Read-only status for the login page and admin scripts. Contains no secrets. */
    status() {
      const acct = repo.getAccount();
      return {
        accountExists: !!acct,
        username: acct?.username ?? null,
        totpEnrolled: !!acct?.totp_secret,
        unusedRecoveryCodes: acct ? repo.unusedRecoveryCodes().length : 0,
        activeSessions: repo.countSessions(),
      };
    },

    /**
     * One-step sign in: username + password + (TOTP or recovery code). Any wrong factor
     * gives the same generic failure (AC3). Every factor is checked regardless of the
     * others, so timing does not reveal which one was wrong. Codes are consumed only when
     * every factor is right, so a password guesser cannot burn TOTP steps or recovery codes.
     */
    async login(input: { username: string; password: string; code?: string; ip: string; presentedSessionId?: string | null }): Promise<LoginResult> {
      const username = String(input.username ?? "");
      const password = String(input.password ?? "");
      const code = String(input.code ?? "").trim();
      let usedRecoveryCode = false;
      const r = await attempt(input.ip, async (t) => {
        if (username.length > MAX_USERNAME || password.length > PASSWORD_MAX_LENGTH || code.length > MAX_CODE) return null;
        const acct = repo.getAccount();
        const pwMatches = await verifyPassword(acct?.password_hash ?? (await dummyHash()), password);
        const userMatches = acct ? safeEqual(normalizeUsername(username), acct.username) : false;
        const passwordOk = !!acct && pwMatches && userMatches;

        const enrolled = !!acct?.totp_secret;
        let totpStep: number | null = null;
        let recoveryId: number | null = null;
        if (acct?.totp_secret) {
          if (looksLikeTotp(code)) totpStep = verifyTotp(acct.totp_secret, code, t.getTime(), acct.totp_last_step);
          else if (looksLikeRecoveryCode(code)) recoveryId = await matchRecoveryCode(code, repo.unusedRecoveryCodes());
        }
        const codeOk = !enrolled || totpStep !== null || recoveryId !== null;
        if (!acct || !passwordOk || !codeOk) return null;

        // Enrolled: always full + 2FA. Not enrolled: full only when password-only is
        // allowed (local flag); otherwise a restricted session that can only enrol (BR-19).
        const kind: "full" | "enrol" = enrolled || config.allowPasswordOnly ? "full" : "enrol";
        const rehashed = needsRehash(acct.password_hash) ? await hashPassword(password) : null;
        return () => {
          if (totpStep !== null && !repo.advanceTotpStep(totpStep)) return null; // concurrent replay
          if (recoveryId !== null) {
            if (!repo.consumeRecoveryCode(recoveryId, iso(t))) return null; // used concurrently
            usedRecoveryCode = true;
          }
          if (rehashed) repo.updatePasswordHash(rehashed, iso(t));
          // Session rotation: the id the browser presented (if any) is destroyed; a new
          // random id is issued (no session fixation).
          if (input.presentedSessionId) repo.deleteSession(hashSessionId(input.presentedSessionId));
          pruneSessions(t);
          return { ...createSession(kind, enrolled, t), kind };
        };
      });
      if (!r.ok) return r;
      return { ok: true, ...r.value, usedRecoveryCode };
    },

    /**
     * Look up a session; expired or invalid sessions are deleted. Only Owner activity
     * slides the 12 h idle window: pass `{ activity: false }` for background polling, SSE
     * streams and prefetches (ArchitectBot (a)), which are checked but never extend it.
     */
    validateSession(rawId: string | null | undefined, opts: { activity?: boolean } = {}): SessionInfo | null {
      const activity = opts.activity ?? true;
      if (!rawId || !SESSION_ID_RE.test(rawId)) return null;
      const idHash = hashSessionId(rawId);
      const s = repo.getSession(idHash);
      if (!s) return null;
      const t = now().getTime();
      const created = Date.parse(s.created_at);
      const lastSeen = Date.parse(s.last_seen_at);
      const lifetime = s.kind === "full" ? config.absoluteMs : config.enrolMs;
      const acct = repo.getAccount();
      const expired =
        !acct ||
        t - lastSeen >= config.idleMs || // AC5: 12 h idle
        t - created >= lifetime || // AC5a: 7 days absolute, then full re-login incl. 2FA
        Date.parse(acct.password_changed_at) > created || // password reset ends older sessions
        (s.kind === "full" && s.mfa === 0 && (mfaRequired || !!acct.totp_secret)); // password-only session no longer allowed
      if (expired) {
        repo.deleteSession(idHash);
        return null;
      }
      if (activity) repo.touchSession(idHash, iso(t));
      const seen = activity ? t : lastSeen;
      return {
        kind: s.kind,
        mfa: s.mfa === 1,
        createdAt: new Date(created),
        lastSeenAt: new Date(seen),
        absoluteExpiresAt: new Date(created + lifetime),
        idleExpiresAt: new Date(Math.min(seen + config.idleMs, created + lifetime)),
      };
    },

    /** AC6: sign out destroys the server-side session. */
    logout(rawId: string | null | undefined): void {
      if (rawId && SESSION_ID_RE.test(rawId)) repo.deleteSession(hashSessionId(rawId));
    },

    /** May this session use the enrolment page? Only while the account has no 2FA yet. */
    canEnrol(s: SessionInfo | null): boolean {
      const acct = repo.getAccount();
      return !!s && !!acct && !acct.totp_secret;
    },

    /** Get (or create) the pending TOTP secret for enrolment. Generated locally. */
    startEnrolment(s: SessionInfo | null): { secret: string; uri: string } | null {
      if (!auth.canEnrol(s)) return null;
      const acct = repo.getAccount()!;
      let secret = acct.totp_pending_secret;
      if (!secret) {
        secret = generateTotpSecret();
        repo.setPendingTotp(secret, iso());
      }
      return { secret, uri: otpauthUri(secret, acct.username) };
    },

    /**
     * Confirm enrolment with a first valid code. Returns 10 recovery codes to show once
     * (only hashes are stored) and a rotated full 2FA session.
     */
    async confirmEnrolment(input: { sessionId: string | null | undefined; code: string; ip: string }): Promise<EnrolResult> {
      const s = auth.validateSession(input.sessionId);
      if (!s || !auth.canEnrol(s)) return { ok: false, reason: "failed" };
      const code = String(input.code ?? "").trim();
      const r = await attempt(input.ip, async (t) => {
        const secret = repo.getAccount()?.totp_pending_secret;
        if (!secret) return null;
        const step = verifyTotp(secret, code, t.getTime(), null);
        if (step === null) return null;
        const codes = generateRecoveryCodes();
        const hashes = await hashCodes(codes);
        return () => {
          if (!repo.activateTotp(secret, step, iso(t))) return null;
          repo.replaceRecoveryCodes(hashes, iso(t));
          repo.deleteSession(hashSessionId(input.sessionId!)); // rotate
          return { ...createSession("full", true, t), recoveryCodes: codes };
        };
      });
      return r.ok ? { ok: true, ...r.value } : r;
    },

    /**
     * New set of 10 recovery codes. Requires a full session plus the password AND a current
     * TOTP code (not a recovery code). The old set stops working immediately.
     */
    async regenerateRecoveryCodes(input: { sessionId: string | null | undefined; password: string; code: string; ip: string }): Promise<RegenerateResult> {
      const s = auth.validateSession(input.sessionId);
      if (!s || s.kind !== "full") return { ok: false, reason: "failed" };
      const password = String(input.password ?? "");
      const code = String(input.code ?? "").trim();
      const r = await attempt(input.ip, async (t) => {
        if (password.length > PASSWORD_MAX_LENGTH) return null;
        const acct = repo.getAccount();
        if (!acct?.totp_secret) return null;
        const pwOk = await verifyPassword(acct.password_hash, password);
        const step = verifyTotp(acct.totp_secret, code, t.getTime(), acct.totp_last_step);
        if (!pwOk || step === null) return null;
        const codes = generateRecoveryCodes();
        const hashes = await hashCodes(codes);
        return () => {
          if (!repo.advanceTotpStep(step)) return null;
          repo.replaceRecoveryCodes(hashes, iso(t));
          return codes;
        };
      });
      return r.ok ? { ok: true, recoveryCodes: r.value } : r;
    },

    // ---- host-only admin operations (AC7), used by scripts/admin-*.ts ----

    /** Initial setup and reset. Ends every session and clears all throttles. 2FA is kept. */
    async setPassword(username: string, password: string): Promise<void> {
      const u = normalizeUsername(username);
      if (!/^[a-z0-9._-]{1,64}$/.test(u)) throw new Error("Username: 1-64 characters, letters, digits, dot, dash or underscore.");
      const problem = passwordPolicyError(password);
      if (problem) throw new Error(problem);
      const h = await hashPassword(password);
      repo.tx(() => {
        repo.upsertPassword(u, h, iso());
        repo.deleteAllSessions();
        repo.clearThrottles();
      });
    },

    /** Clears TOTP and recovery codes; the Owner re-enrols at next sign-in. Ends every session. */
    resetTwoFactor(): { hadAccount: boolean } {
      return repo.tx(() => {
        const hadAccount = !!repo.getAccount();
        repo.clearTotp(iso());
        repo.deleteAllSessions();
        repo.clearThrottles();
        return { hadAccount };
      });
    },

    /** Clears every IP throttle and the account-wide backoff. Returns attempts removed. */
    unlock(): number {
      return repo.tx(() => repo.clearThrottles());
    },
  };
  return auth;
}
export type Auth = ReturnType<typeof createAuth>;
