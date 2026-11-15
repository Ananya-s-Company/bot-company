import { beforeEach, describe, expect, it, vi } from "vitest";

// Server actions run against the real auth service and app data (in-memory DB). Only the
// Next.js request APIs are replaced by a fake request.
const req = vi.hoisted(() => ({
  headers: new Headers(),
  cookies: new Map<string, string>(),
  set: [] as { name: string; value: string; opts: Record<string, unknown> }[],
}));
vi.mock("next/headers", () => ({
  headers: async () => req.headers,
  cookies: async () => ({
    get: (n: string) => (req.cookies.has(n) ? { name: n, value: req.cookies.get(n)! } : undefined),
    set: (name: string, value: string, opts: Record<string, unknown>) => {
      req.set.push({ name, value, opts });
      req.cookies.set(name, value);
    },
    delete: (n: string) => req.cookies.delete(n),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { regenerateRecoveryCodes } from "../app/account/actions";
import { saveIdea } from "../app/ideas/[id]/actions";
import { signIn } from "../app/login/actions";
import { resolveAuthConfig } from "../lib/auth/config";
import { SESSION_COOKIE } from "../lib/auth/http";
import { setAuthForTests } from "../lib/auth/runtime";
import { createAuth, type Auth } from "../lib/auth/service";
import { totpAt } from "../lib/auth/totp";
import { clearDraft, loadDraft, saveDraft, serializeForm } from "../lib/client/draft";
import { getData } from "../lib/data";
import { getDb } from "../lib/data/db";
import { PASSWORD, USERNAME } from "./auth-helpers";

const ORIGIN = "https://cc.example";
let t = Date.parse("2026-11-15T12:00:00.000Z");
let auth: Auth;
let secret: string;

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}
/** next/navigation redirect() throws; return its target instead. */
async function redirectOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? "");
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2] ?? null;
  }
}

beforeEach(async () => {
  t += 3600_000; // fresh TOTP step and no backoff between tests
  req.headers = new Headers({ host: "cc.example", origin: ORIGIN, "x-forwarded-for": "203.0.113.50" });
  req.cookies.clear();
  req.set = [];
  if (!auth) {
    auth = createAuth({ db: getDb(), now: () => new Date(t), config: resolveAuthConfig({ NODE_ENV: "test" }) });
    setAuthForTests(auth);
    await auth.setPassword(USERNAME, PASSWORD);
    const r = await auth.login({ username: USERNAME, password: PASSWORD, ip: "203.0.113.1" });
    secret = auth.startEnrolment(auth.validateSession(r.ok ? r.sessionId : null))!.secret;
    await auth.confirmEnrolment({ sessionId: r.ok ? r.sessionId : null, code: totpAt(secret, t), ip: "203.0.113.1" });
    t += 3600_000;
  }
  auth.unlock();
});

describe("sign-in action (AC2, AC3)", () => {
  it("wrong credentials: the generic message, no cookie", async () => {
    expect(await signIn({}, fd({ username: USERNAME, password: "nope nope nope", code: totpAt(secret, t) }))).toEqual({ error: "Sign-in failed" });
    t += 61_000; // past the account backoff
    expect(await signIn({}, fd({ username: "who", password: PASSWORD, code: totpAt(secret, t + 30_000) }))).toEqual({ error: "Sign-in failed" });
    expect(req.set).toEqual([]);
  });

  it("valid credentials: sets __Host-cc_session (Secure, Path=/) and lands on Home", async () => {
    const to = await redirectOf(signIn({}, fd({ username: USERNAME, password: PASSWORD, code: totpAt(secret, t) })));
    expect(to).toBe("/");
    expect(req.set).toHaveLength(1);
    expect(req.set[0]).toMatchObject({ name: SESSION_COOKIE, opts: { httpOnly: true, secure: true, sameSite: "strict", path: "/" } });
    expect(auth.validateSession(req.set[0]!.value)?.kind).toBe("full");
  });

  it("honours a safe ?next= and ignores an off-site one", async () => {
    expect(await redirectOf(signIn({}, fd({ username: USERNAME, password: PASSWORD, code: totpAt(secret, t), next: "/ideas/x" })))).toBe("/ideas/x");
    t += 60_000;
    expect(await redirectOf(signIn({}, fd({ username: USERNAME, password: PASSWORD, code: totpAt(secret, t), next: "https://evil.example/" })))).toBe("/");
  });

  it("AC4: after 5 failures the action reports the 15-minute block", async () => {
    for (let i = 0; i < 5; i++) {
      await signIn({}, fd({ username: USERNAME, password: "nope nope nope" }));
      t += 61_000;
    }
    const r = await signIn({}, fd({ username: USERNAME, password: PASSWORD, code: totpAt(secret, t) }));
    expect(r.error).toMatch(/^Sign-in failed\. Too many attempts: try again in 1[0-5] minutes\.$/);
  });
});

describe("expired session mid-action (CC-01 edge case)", () => {
  it("saving with an expired session writes nothing and asks to re-authenticate; the draft survives", async () => {
    const idea = getData().ideas.create({ name: "Draft test", owning_lead_bot: "PMBot" });
    const form = fd({ name: "My unsaved rename", owning_lead_bot: "PMBot", stage: idea.stage, next_step: "typed note" });
    // No session at all (expired and deleted).
    const r = await saveIdea(idea.id, { ok: false }, form);
    expect(r).toMatchObject({ ok: false, reauth: true });
    expect(getData().ideas.get(idea.id)!.name).toBe("Draft test");
    // The form keeps the input in this tab's storage across the trip to /login.
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    saveDraft(`idea-edit:${idea.id}`, serializeForm(form), storage);
    expect(loadDraft(`idea-edit:${idea.id}`, storage)).toMatchObject({ name: "My unsaved rename", next_step: "typed note" });
    // After signing in again the same input saves.
    await redirectOf(signIn({}, fd({ username: USERNAME, password: PASSWORD, code: totpAt(secret, t) })));
    expect((await saveIdea(idea.id, { ok: false }, form)).ok).toBe(true);
    expect(getData().ideas.get(idea.id)!.name).toBe("My unsaved rename");
    clearDraft(`idea-edit:${idea.id}`, storage);
    expect(loadDraft(`idea-edit:${idea.id}`, storage)).toBeNull();
  });

  it("a cross-origin action call is refused even with a valid session", async () => {
    await redirectOf(signIn({}, fd({ username: USERNAME, password: PASSWORD, code: totpAt(secret, t) })));
    const idea = getData().ideas.create({ name: "CSRF test", owning_lead_bot: "PMBot" });
    req.headers = new Headers({ host: "cc.example", origin: "https://evil.example" });
    expect(await saveIdea(idea.id, { ok: false }, fd({ name: "pwned", owning_lead_bot: "PMBot", stage: idea.stage }))).toMatchObject({ reauth: true });
    expect(getData().ideas.get(idea.id)!.name).toBe("CSRF test");
  });
});

describe("recovery-code sign-in action (AC3b, AC7)", () => {
  it("a recovery code signs in once, then points to the Security page; reusing it fails generically", async () => {
    const r = await auth.login({ username: USERNAME, password: PASSWORD, code: totpAt(secret, t), ip: "203.0.113.2" });
    t += 30_000;
    const regen = await auth.regenerateRecoveryCodes({ sessionId: r.ok ? r.sessionId : null, password: PASSWORD, code: totpAt(secret, t), ip: "203.0.113.2" });
    const code = regen.ok ? regen.recoveryCodes[0]! : "";
    expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    t += 61_000;
    // Lost authenticator: password + recovery code restores access.
    expect(await redirectOf(signIn({}, fd({ username: USERNAME, password: PASSWORD, code })))).toBe("/account?recovery=used");
    t += 61_000;
    req.set = [];
    expect(await signIn({}, fd({ username: USERNAME, password: PASSWORD, code }))).toEqual({ error: "Sign-in failed" });
    expect(req.set).toEqual([]);
  });
});

describe("login form", () => {
  it("accepts a password as long as the admin command allows and offers one code field (TOTP or recovery)", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { LoginForm } = await import("../components/LoginForm");
    const { PASSWORD_MAX_LENGTH } = await import("../lib/auth/password");
    const html = renderToStaticMarkup(createElement(LoginForm, { next: "/", codeOptional: false }));
    const pw = html.match(/<input[^>]*name="password"[^>]*>/)?.[0] ?? "";
    expect(pw).toContain(`maxLength="${PASSWORD_MAX_LENGTH}"`);
    expect(html).toContain('name="code"');
    expect(html).toContain("xxxxx-xxxxx");
    expect(html).not.toMatch(/forgot|reset|sign up|register/i); // AC7, BR-01
  });
});

describe("recovery-code regeneration action (AC3b)", () => {
  it("returns 10 new xxxxx-xxxxx codes only for a signed-in Owner with password + TOTP", async () => {
    expect(await regenerateRecoveryCodes({}, fd({ password: PASSWORD, code: totpAt(secret, t) }))).toMatchObject({ reauth: true });
    await redirectOf(signIn({}, fd({ username: USERNAME, password: PASSWORD, code: totpAt(secret, t) })));
    t += 30_000;
    const r = await regenerateRecoveryCodes({}, fd({ password: PASSWORD, code: totpAt(secret, t) }));
    expect(r.recoveryCodes).toHaveLength(10);
    for (const c of r.recoveryCodes!) expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
  });
});
