import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adminReset2fa, adminSetPassword, adminUnlock, type AdminIo } from "../lib/auth/admin";
import { backoffDelayMs, createAuth, hashSessionId } from "../lib/auth/service";
import { IP, PASSWORD, USERNAME, makeAuth, setupOwner, type TestAuth } from "./auth-helpers";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Wrong-password login that also waits out the account backoff afterwards. */
async function failOnce(h: TestAuth, ip = IP, code?: string) {
  const r = await h.auth.login({ username: USERNAME, password: "wrong password!!", code, ip });
  h.advance(61_000);
  return r;
}

describe("CC-01 sign in (AC2, AC3, AC3a)", () => {
  it("signs in with password + TOTP and gives one generic failure for every wrong factor", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const variants = [
      { username: "nobody", password: PASSWORD, code: h.code(secret!) },
      { username: USERNAME, password: "wrong password!!", code: h.code(secret!) },
      { username: USERNAME, password: PASSWORD, code: "000000" },
      { username: USERNAME, password: PASSWORD, code: "" },
    ];
    for (const v of variants) {
      expect(await h.auth.login({ ...v, ip: IP })).toEqual({ ok: false, reason: "failed" });
      h.advance(61_000);
    }
    const ok = await h.auth.login({ username: " OWNER ", password: PASSWORD, code: h.code(secret!), ip: IP });
    expect(ok).toMatchObject({ ok: true, kind: "full", usedRecoveryCode: false });
  });

  it("password-only is OFF by default: a correct password without 2FA only allows enrolment", async () => {
    const h = makeAuth();
    expect(h.config.allowPasswordOnly).toBe(false);
    await setupOwner(h, { enrol: false });
    const r = await h.auth.login({ username: USERNAME, password: PASSWORD, ip: IP });
    expect(r).toMatchObject({ ok: true, kind: "enrol" });
    const s = h.auth.validateSession(r.ok ? r.sessionId : null);
    expect(s?.kind).toBe("enrol");
    h.advance(31 * MIN); // the restricted enrolment session is short-lived
    expect(h.auth.validateSession(r.ok ? r.sessionId : null)).toBeNull();
  });

  it("local password-only flag allows a full password-only session, but never in hosted mode (BR-19)", async () => {
    const local = makeAuth({ env: { CC_ALLOW_PASSWORD_ONLY: "true" } });
    await setupOwner(local, { enrol: false });
    expect(await local.auth.login({ username: USERNAME, password: PASSWORD, ip: IP })).toMatchObject({ ok: true, kind: "full" });

    const hosted = makeAuth({ env: { CC_ALLOW_PASSWORD_ONLY: "true", CC_HOSTED: "true" } });
    expect(hosted.config).toMatchObject({ allowPasswordOnly: false, passwordOnlyIgnored: true });
    await setupOwner(hosted, { enrol: false });
    expect(await hosted.auth.login({ username: USERNAME, password: PASSWORD, ip: IP })).toMatchObject({ ok: true, kind: "enrol" });
  });

  it("once 2FA is enrolled, the password-only flag cannot skip the code", async () => {
    const h = makeAuth({ env: { CC_ALLOW_PASSWORD_ONLY: "1" } });
    await setupOwner(h);
    expect(await h.auth.login({ username: USERNAME, password: PASSWORD, ip: IP })).toEqual({ ok: false, reason: "failed" });
  });

  it("enrolment: secret generated locally, wrong code rejected, recovery codes returned once", async () => {
    const h = makeAuth();
    await setupOwner(h, { enrol: false });
    const r = await h.auth.login({ username: USERNAME, password: PASSWORD, ip: IP });
    const sid = r.ok ? r.sessionId : "";
    const e = h.auth.startEnrolment(h.auth.validateSession(sid))!;
    expect(e.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(h.auth.startEnrolment(h.auth.validateSession(sid))!.secret).toBe(e.secret); // stable until confirmed
    expect(await h.auth.confirmEnrolment({ sessionId: sid, code: "123456", ip: IP })).toEqual({ ok: false, reason: "failed" });
    h.advance(61_000);
    const done = await h.auth.confirmEnrolment({ sessionId: sid, code: h.code(e.secret), ip: IP });
    expect(done.ok && done.recoveryCodes).toHaveLength(10);
    expect(h.auth.validateSession(sid)).toBeNull(); // rotated
    expect(h.auth.status()).toMatchObject({ totpEnrolled: true, unusedRecoveryCodes: 10 });
    // Only hashes are stored.
    const stored = (h.db.prepare("SELECT code_hash FROM owner_recovery_codes").all() as { code_hash: string }[]).map((x) => x.code_hash);
    for (const c of done.ok ? done.recoveryCodes : []) expect(stored.join()).not.toContain(c.replace(/-/g, ""));
    expect(h.auth.startEnrolment(h.auth.validateSession(done.ok ? done.sessionId : null))).toBeNull(); // cannot re-enrol
  });
});

describe("TOTP replay at sign-in", () => {
  it("a code cannot be reused within its window, even for a second sign-in", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const code = h.code(secret!);
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code, ip: IP })).ok).toBe(true);
    h.advance(10_000); // still the same 30 s step
    expect(await h.auth.login({ username: USERNAME, password: PASSWORD, code, ip: IP })).toEqual({ ok: false, reason: "failed" });
    h.advance(61_000);
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP })).ok).toBe(true);
  });
  it("a wrong password does not burn the TOTP step", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const code = h.code(secret!);
    await h.auth.login({ username: USERNAME, password: "wrong password!!", code, ip: IP });
    h.advance(1_500); // past the 1 s backoff, same step
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code, ip: IP })).ok).toBe(true);
  });
});

describe("recovery codes (AC3b)", () => {
  it("each code works exactly once", async () => {
    const h = makeAuth();
    const { codes } = await setupOwner(h);
    const r = await h.auth.login({ username: USERNAME, password: PASSWORD, code: codes[0]!.toLowerCase(), ip: IP });
    expect(r).toMatchObject({ ok: true, kind: "full", usedRecoveryCode: true });
    expect(h.auth.status().unusedRecoveryCodes).toBe(9);
    h.advance(61_000);
    expect(await h.auth.login({ username: USERNAME, password: PASSWORD, code: codes[0]!, ip: IP })).toEqual({ ok: false, reason: "failed" });
    h.advance(61_000);
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: codes[1]!, ip: IP })).ok).toBe(true);
  });

  it("a wrong password does not consume a recovery code", async () => {
    const h = makeAuth();
    const { codes } = await setupOwner(h);
    await failOnce(h, IP, codes[0]);
    expect(h.auth.status().unusedRecoveryCodes).toBe(10);
  });

  it("regeneration needs password + current TOTP and invalidates the whole old set", async () => {
    const h = makeAuth();
    const { secret, codes, sessionId } = await setupOwner(h);
    // Wrong password, or a recovery code instead of TOTP: refused.
    expect(await h.auth.regenerateRecoveryCodes({ sessionId, password: "wrong password!!", code: h.code(secret!), ip: IP })).toEqual({ ok: false, reason: "failed" });
    h.advance(61_000);
    expect(await h.auth.regenerateRecoveryCodes({ sessionId, password: PASSWORD, code: codes[0]!, ip: IP })).toEqual({ ok: false, reason: "failed" });
    h.advance(61_000);
    expect(await h.auth.regenerateRecoveryCodes({ sessionId: null, password: PASSWORD, code: h.code(secret!), ip: IP })).toEqual({ ok: false, reason: "failed" });

    const r = await h.auth.regenerateRecoveryCodes({ sessionId, password: PASSWORD, code: h.code(secret!), ip: IP });
    expect(r.ok).toBe(true);
    const fresh = r.ok ? r.recoveryCodes : [];
    expect(fresh).toHaveLength(10);
    expect(fresh.some((c) => codes.includes(c))).toBe(false);
    h.advance(61_000);
    for (const old of codes.slice(0, 2)) {
      expect(await h.auth.login({ username: USERNAME, password: PASSWORD, code: old, ip: IP })).toEqual({ ok: false, reason: "failed" });
      h.advance(61_000);
    }
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: fresh[0]!, ip: IP })).ok).toBe(true);
  });
});

describe("throttling (no hard owner lockout)", () => {
  it("TOTP and recovery-code failures share one counter with passwords; the 6th attempt is blocked", async () => {
    const h = makeAuth();
    const { secret, codes } = await setupOwner(h);
    await failOnce(h); // wrong password
    for (const code of ["000000", "111111"]) {
      expect(await h.auth.login({ username: USERNAME, password: PASSWORD, code, ip: IP })).toEqual({ ok: false, reason: "failed" });
      h.advance(61_000);
    }
    for (const code of ["aaaaa-bbbbb", "ddddd-eeeee"]) {
      expect(await h.auth.login({ username: USERNAME, password: PASSWORD, code, ip: IP })).toEqual({ ok: false, reason: "failed" });
      h.advance(61_000);
    }
    // 6th attempt within 15 minutes: blocked without checking, even with correct factors.
    const sixth = await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP });
    expect(sixth).toMatchObject({ ok: false, reason: "throttled" });
    expect(sixth.ok === false && sixth.reason === "throttled" && sixth.retryAfterMs).toBeGreaterThan(0);
    expect(h.auth.status().unusedRecoveryCodes).toBe(codes.length); // nothing consumed
    // Another IP is not affected by this IP's throttle.
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: "198.51.100.1" })).ok).toBe(true);
  });

  it("enrolment-code failures count too", async () => {
    const h = makeAuth();
    await setupOwner(h, { enrol: false });
    const r = await h.auth.login({ username: USERNAME, password: PASSWORD, ip: IP });
    const sid = r.ok ? r.sessionId : "";
    h.auth.startEnrolment(h.auth.validateSession(sid));
    for (let i = 0; i < 5; i++) {
      expect(await h.auth.confirmEnrolment({ sessionId: sid, code: "000000", ip: IP })).toEqual({ ok: false, reason: "failed" });
      h.advance(61_000);
    }
    expect(await h.auth.confirmEnrolment({ sessionId: sid, code: "000000", ip: IP })).toMatchObject({ reason: "throttled" });
  });

  it("AC4: 5 failures within 15 minutes block further attempts for 15 minutes", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    for (let i = 0; i < 5; i++) expect(await failOnce(h)).toEqual({ ok: false, reason: "failed" }); // 5 failures in ~5 min
    // failOnce already waited 61 s after the 5th failure.
    const blocked = await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP });
    expect(blocked).toMatchObject({ reason: "throttled" });
    const wait = blocked.ok === false && blocked.reason === "throttled" ? blocked.retryAfterMs : 0;
    expect(wait).toBe(15 * MIN - 61_000); // 15 min from the 5th failure, not from the 1st
    h.advance(wait - 1000);
    // Still blocked one second before the end, even with every factor correct; retrying does not extend it.
    expect(await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP })).toMatchObject({ reason: "throttled", retryAfterMs: 1000 });
    h.advance(1000);
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP })).ok).toBe(true);
  });

  it("AC4: failures spread over more than 15 minutes do not block", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    for (let i = 0; i < 5; i++) {
      expect(await h.auth.login({ username: USERNAME, password: "wrong password!!", ip: IP })).toEqual({ ok: false, reason: "failed" });
      h.advance(4 * MIN); // 1st and 5th are 16 minutes apart
    }
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP })).ok).toBe(true);
  });

  it("a success clears that IP's failures and the account backoff", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    for (let i = 0; i < 4; i++) await failOnce(h);
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP })).ok).toBe(true);
    for (let i = 0; i < 5; i++) expect(await failOnce(h)).toEqual({ ok: false, reason: "failed" });
  });

  it("account-wide backoff doubles from 1 s and is capped at 60 s, across IPs", async () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20, 1000].map((n) => backoffDelayMs(n, 1000, 60_000))).toEqual([
      0, 1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000,
    ]);
    const h = makeAuth();
    await setupOwner(h);
    const seen: number[] = [];
    for (let i = 1; i <= 9; i++) {
      const ip = `198.51.100.${i}`; // new IP each time: only the account backoff applies
      expect(await h.auth.login({ username: USERNAME, password: "wrong password!!", ip })).toEqual({ ok: false, reason: "failed" });
      const r = await h.auth.login({ username: USERNAME, password: "wrong password!!", ip: `${ip}9` });
      expect(r).toMatchObject({ reason: "throttled" });
      const wait = r.ok === false && r.reason === "throttled" ? r.retryAfterMs : -1;
      seen.push(wait);
      h.advance(wait);
    }
    expect(seen).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    expect(Math.max(...seen)).toBe(60_000);
  });

  it("parallel attempts cannot exceed the IP limit (attempts are reserved before checking)", async () => {
    const h = makeAuth({ config: { throttle: { ipMaxFailures: 5, ipWindowMs: 15 * MIN, ipLockoutMs: 15 * MIN, backoffBaseMs: 0, backoffMaxMs: 0 } } });
    await setupOwner(h);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => h.auth.login({ username: USERNAME, password: "wrong password!!", ip: IP })),
    );
    expect(results.filter((r) => r.ok === false && r.reason === "failed")).toHaveLength(5);
    expect(results.filter((r) => r.ok === false && r.reason === "throttled")).toHaveLength(7);
  });

  it("npm run admin:unlock clears IP throttles and backoff", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    for (let i = 0; i < 5; i++) await failOnce(h);
    await h.auth.login({ username: USERNAME, password: "wrong password!!", ip: "198.51.100.9" }); // sets backoff again
    expect(await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP })).toMatchObject({ reason: "throttled" });
    const io = fakeIo();
    expect(adminUnlock(h.auth, io)).toBe(0);
    // 6 failures plus the 2 successful attempts recorded by setupOwner (login + enrolment).
    expect(io.lines.join("\n")).toMatch(/throttles cleared \(8 recorded attempts removed\)/);
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP })).ok).toBe(true);
  });
});

describe("sessions (AC5, AC5a, AC6, rotation)", () => {
  async function signedIn(h: TestAuth, secret: string, presentedSessionId?: string | null) {
    const r = await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret), ip: IP, presentedSessionId });
    if (!r.ok) throw new Error("login failed");
    h.advance(30_000);
    return r.sessionId;
  }

  it("stores only a hash of a random 32-byte id", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const sid = await signedIn(h, secret!);
    expect(Buffer.from(sid, "base64url")).toHaveLength(32);
    const rows = h.db.prepare("SELECT id_hash FROM owner_sessions").all() as { id_hash: string }[];
    expect(rows.map((r) => r.id_hash)).toContain(hashSessionId(sid));
    expect(JSON.stringify(rows)).not.toContain(sid);
  });

  it("expires after 12 hours idle; activity slides the idle window", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const sid = await signedIn(h, secret!);
    h.advance(11 * HOUR);
    expect(h.auth.validateSession(sid)).not.toBeNull(); // activity
    h.advance(12 * HOUR - 1000);
    expect(h.auth.validateSession(sid)).not.toBeNull();
    h.advance(12 * HOUR);
    expect(h.auth.validateSession(sid)).toBeNull();
    expect(h.auth.validateSession(sid)).toBeNull(); // deleted, stays gone
  });

  it("forces re-login (including 2FA) 7 days after sign-in regardless of activity", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const sid = await signedIn(h, secret!);
    for (let elapsed = 0; elapsed < 7 * DAY - 11 * HOUR; elapsed += 11 * HOUR) {
      h.advance(11 * HOUR);
      expect(h.auth.validateSession(sid)).not.toBeNull();
    }
    h.advance(11 * HOUR);
    expect(h.auth.validateSession(sid)).toBeNull();
    // A new sign-in requires the TOTP code again.
    expect(await h.auth.login({ username: USERNAME, password: PASSWORD, ip: IP })).toEqual({ ok: false, reason: "failed" });
  });

  it("test-only duration overrides shorten the 12 h and 7 d limits", async () => {
    // signedIn() leaves the clock 30 s after sign-in.
    const h = makeAuth({ env: { CC_TEST_IDLE_MS: "60000", CC_TEST_ABSOLUTE_MS: "300000" } });
    const { secret } = await setupOwner(h);
    const sid = await signedIn(h, secret!);
    h.advance(30_000); // 60 s idle
    expect(h.auth.validateSession(sid)).toBeNull();
    const sid2 = await signedIn(h, secret!);
    for (let i = 0; i < 10; i++) {
      h.advance(25_000); // active: under the 60 s idle limit each time
      expect(h.auth.validateSession(sid2)).not.toBeNull();
    }
    h.advance(25_000); // 305 s after sign-in: absolute limit, although only 25 s idle
    expect(h.auth.validateSession(sid2)).toBeNull();
    // Outside NODE_ENV=test the overrides are ignored.
    expect(makeAuth({ env: { NODE_ENV: "production", CC_TEST_IDLE_MS: "1" } }).config.idleMs).toBe(12 * HOUR);
  });

  it("rotates the session id on login: the presented id is destroyed", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const first = await signedIn(h, secret!);
    const second = await signedIn(h, secret!, first);
    expect(second).not.toBe(first);
    expect(h.auth.validateSession(first)).toBeNull();
    expect(h.auth.validateSession(second)).not.toBeNull();
    // A planted (fixated) id that was never issued is not adopted either.
    const planted = randomBytes(32).toString("base64url");
    const third = await signedIn(h, secret!, planted);
    expect(third).not.toBe(planted);
    expect(h.auth.validateSession(planted)).toBeNull();
  });

  it("sign out destroys the server-side session", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const sid = await signedIn(h, secret!);
    h.auth.logout(sid);
    expect(h.auth.validateSession(sid)).toBeNull();
  });

  it("rejects malformed or unknown ids", () => {
    const h = makeAuth();
    for (const id of [null, "", "x", "a".repeat(43), "../../etc/passwd"]) expect(h.auth.validateSession(id)).toBeNull();
  });
});

describe("BR-02: bot tokens can never log into the UI", () => {
  it("a registered bot token is not a password, a code or a session id", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const token = randomBytes(32).toString("base64url"); // same shape as a session id
    h.data.credentials.register("RiskBot", createHash("sha256").update(token).digest("hex"));
    for (const username of ["RiskBot", USERNAME]) {
      expect(await h.auth.login({ username, password: token, code: token, ip: IP })).toEqual({ ok: false, reason: "failed" });
      h.advance(61_000);
    }
    expect(h.auth.validateSession(token)).toBeNull();
    // Owner sign-in still works and the bot credential is untouched.
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP })).ok).toBe(true);
    expect(h.data.credentials.list()).toMatchObject([{ bot_name: "RiskBot", status: "active" }]);
  });

  it("owner auth code has no path to bot_credentials (separate table and code path)", () => {
    const files = [...fs.readdirSync(path.join(__dirname, "../lib/auth")).map((f) => `lib/auth/${f}`), "lib/data/owner-auth.ts"];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
      expect(src, f).not.toMatch(/(FROM|JOIN|INTO|UPDATE)\s+bot_credentials/i);
      expect(src, f).not.toMatch(/data\/credentials/);
    }
  });
});

function fakeIo(lines: string[] = [], interactive = false): AdminIo & { lines: string[] } {
  const input = [...lines];
  const out: string[] = [];
  return {
    interactive,
    lines: out,
    readSecret: async () => input.shift() ?? "",
    readLine: async () => input.shift() ?? "",
    out: (m) => out.push(m),
  };
}

describe("host admin commands (AC7)", () => {
  it("admin:set-password does initial setup, then resets the password and ends every session", async () => {
    const h = makeAuth();
    const io = fakeIo(["first password 123"]);
    expect(await adminSetPassword(h.auth, io, {})).toBe(0);
    expect(h.auth.status()).toMatchObject({ accountExists: true, username: "owner", totpEnrolled: false });
    expect(io.lines.join("\n")).not.toContain("first password 123");

    const { secret } = await (async () => {
      const r = await h.auth.login({ username: "owner", password: "first password 123", ip: IP });
      const sid = r.ok ? r.sessionId : "";
      const e = h.auth.startEnrolment(h.auth.validateSession(sid))!;
      const done = await h.auth.confirmEnrolment({ sessionId: sid, code: h.code(e.secret), ip: IP });
      h.advance(30_000);
      return { secret: e.secret, sid: done.ok ? done.sessionId : "" };
    })();
    expect(h.auth.status().activeSessions).toBe(1);

    // Interactive reset with confirmation; 2FA is kept.
    const io2 = fakeIo(["", "a brand new password", "a brand new password"], true);
    expect(await adminSetPassword(h.auth, io2, {})).toBe(0);
    expect(h.auth.status()).toMatchObject({ activeSessions: 0, totpEnrolled: true });
    expect(await h.auth.login({ username: "owner", password: "first password 123", code: h.code(secret), ip: IP })).toEqual({ ok: false, reason: "failed" });
    h.advance(61_000);
    expect((await h.auth.login({ username: "owner", password: "a brand new password", code: h.code(secret), ip: IP })).ok).toBe(true);
  });

  it("admin:set-password refuses short or mismatched passwords", async () => {
    const h = makeAuth();
    expect(await adminSetPassword(h.auth, fakeIo(["short"]), {})).toBe(1);
    expect(await adminSetPassword(h.auth, fakeIo(["owner", "long enough pass", "different pass!!"], true), {})).toBe(1);
    expect(h.auth.status().accountExists).toBe(false);
  });

  it("admin:reset-2fa removes TOTP and recovery codes, ends sessions, and the owner re-enrols", async () => {
    const h = makeAuth();
    const { codes } = await setupOwner(h);
    expect(await adminReset2fa(h.auth, fakeIo([]), {})).toBe(1); // non-interactive needs --yes
    expect(await adminReset2fa(h.auth, fakeIo(["no"], true), {})).toBe(1);
    expect(await adminReset2fa(h.auth, fakeIo(["reset"], true), {})).toBe(0);
    expect(h.auth.status()).toMatchObject({ totpEnrolled: false, unusedRecoveryCodes: 0, activeSessions: 0 });
    expect(await h.auth.login({ username: USERNAME, password: PASSWORD, code: codes[0]!, ip: IP })).toMatchObject({ ok: true, kind: "enrol" });
  });
});

describe("ArchitectBot (a): background polling and SSE do not reset the 12 h idle timer", () => {
  it("a background check validates the session but never slides it", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const r = await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP });
    const sid = r.ok ? r.sessionId : "";
    const seen = () => (h.db.prepare("SELECT last_seen_at FROM owner_sessions WHERE id_hash = ?").get(hashSessionId(sid)) as { last_seen_at: string }).last_seen_at;
    const signedInAt = Date.parse(seen());
    // Polling every 30 min for almost 12 h: always valid, and last activity never moves.
    for (let elapsed = 30 * MIN; elapsed < 12 * HOUR; elapsed += 30 * MIN) {
      h.advance(30 * MIN);
      const s = h.auth.validateSession(sid, { activity: false });
      expect(s).not.toBeNull();
      expect(s!.idleExpiresAt.getTime()).toBe(signedInAt + 12 * HOUR);
    }
    expect(Date.parse(seen())).toBe(signedInAt);
    h.advance(signedInAt + 12 * HOUR - h.now().getTime());
    // Exactly 12 h after the last real activity: the poll itself finds the session expired.
    expect(h.auth.validateSession(sid, { activity: false })).toBeNull();
    expect(h.auth.validateSession(sid)).toBeNull();
  });

  it("real Owner activity still slides the window", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const r = await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP });
    const sid = r.ok ? r.sessionId : "";
    h.advance(10 * HOUR);
    expect(h.auth.validateSession(sid)).not.toBeNull(); // page view
    h.advance(10 * HOUR);
    expect(h.auth.validateSession(sid, { activity: false })).not.toBeNull(); // 10 h since the page view
  });
});

describe("ArchitectBot (c): the last accepted TOTP step is stored to block replay", () => {
  const lastStep = (h: TestAuth) =>
    (h.db.prepare("SELECT totp_last_step FROM owner_account WHERE id = 1").get() as { totp_last_step: number | null }).totp_last_step;

  it("persists the step on enrolment and sign-in, and never accepts it (or an older one) again", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const enrolStep = lastStep(h);
    expect(enrolStep).toBe(Math.floor((h.now().getTime() - 30_000) / 30_000)); // stored at enrolment
    // Sign in with the NEXT step's code (allowed by the ±1 step skew) ...
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!, 1), ip: IP })).ok).toBe(true);
    expect(lastStep(h)).toBe(enrolStep! + 2);
    // ... then the current step's code, still inside its window, is refused: it is older.
    h.advance(1000);
    expect(await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP })).toEqual({ ok: false, reason: "failed" });
    expect(lastStep(h)).toBe(enrolStep! + 2);
  });

  it("a replayed code is refused after a restart too (the step lives in the database)", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const code = h.code(secret!);
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code, ip: IP })).ok).toBe(true);
    const restarted = createAuth({ db: h.db, now: h.now, config: h.config }); // new instance, same DB
    h.advance(2000);
    expect(await restarted.login({ username: USERNAME, password: PASSWORD, code, ip: IP })).toEqual({ ok: false, reason: "failed" });
  });

  it("concurrent sign-ins with the same code: only one succeeds", async () => {
    const h = makeAuth({ config: { throttle: { ipMaxFailures: 5, ipWindowMs: 15 * MIN, ipLockoutMs: 15 * MIN, backoffBaseMs: 0, backoffMaxMs: 0 } } });
    const { secret } = await setupOwner(h);
    const code = h.code(secret!);
    const results = await Promise.all([0, 1, 2].map(() => h.auth.login({ username: USERNAME, password: PASSWORD, code, ip: IP })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("AC2: valid credentials sign in quickly", () => {
  it("password + TOTP verification completes well within 3 seconds", async () => {
    const h = makeAuth();
    const { secret } = await setupOwner(h);
    const t0 = performance.now();
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP })).ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it("recovery-code sign-in (checks all 10 argon2id hashes) also completes within 3 seconds", async () => {
    const h = makeAuth();
    const { codes } = await setupOwner(h);
    const t0 = performance.now();
    expect((await h.auth.login({ username: USERNAME, password: PASSWORD, code: codes[9]!, ip: IP })).ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe("BR-01: exactly one human account, no sign-up", () => {
  it("the database cannot hold a second owner account", async () => {
    const h = makeAuth();
    await setupOwner(h, { enrol: false });
    expect(() =>
      h.db
        .prepare("INSERT INTO owner_account (id, username, password_hash, password_changed_at, created_at, updated_at) VALUES (2, 'x', 'x', 'x', 'x', 'x')")
        .run(),
    ).toThrow();
    // setPassword with another username renames the single account instead of adding one.
    await h.auth.setPassword("someone-else", PASSWORD);
    expect((h.db.prepare("SELECT COUNT(*) AS c FROM owner_account").get() as { c: number }).c).toBe(1);
  });
});
