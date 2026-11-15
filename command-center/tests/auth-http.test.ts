import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { GET as sessionGET } from "../app/api/session/route";
import { POST as logoutPOST } from "../app/logout/route";
import { SIGN_IN_FAILED, throttledMessage, withOwnerApi } from "../lib/auth";
import {
  SESSION_COOKIE,
  clientIp,
  forbiddenJson,
  isBackgroundRequest,
  originAllowed,
  parseCookieHeader,
  safeNextPath,
  sessionCookieOptions,
} from "../lib/auth/http";
import { setAuthForTests } from "../lib/auth/runtime";
import { hashSessionId } from "../lib/auth/service";
import { proxy } from "../proxy";
import { IP, PASSWORD, USERNAME, makeAuth, setupOwner, type TestAuth } from "./auth-helpers";

const ORIGIN = "https://cc.example";
const HOUR = 3600_000;
const hdrs = (o: Record<string, string>) => new Headers({ host: "cc.example", ...o });

async function signedInOwner(): Promise<{ h: TestAuth; sid: string }> {
  const h = makeAuth();
  const { secret } = await setupOwner(h);
  const r = await h.auth.login({ username: USERNAME, password: PASSWORD, code: h.code(secret!), ip: IP });
  if (!r.ok) throw new Error("login failed");
  setAuthForTests(h.auth);
  return { h, sid: r.sessionId };
}
const lastSeen = (h: TestAuth, sid: string) =>
  (h.db.prepare("SELECT last_seen_at FROM owner_sessions WHERE id_hash = ?").get(hashSessionId(sid)) as { last_seen_at: string } | undefined)?.last_seen_at;

afterEach(() => setAuthForTests(undefined));

describe("ArchitectBot (b): session cookie __Host-cc_session, Path=/", () => {
  it("is named __Host-cc_session and is HttpOnly, Secure, SameSite=Strict, Path=/", () => {
    expect(SESSION_COOKIE).toBe("__Host-cc_session");
    expect(sessionCookieOptions(7 * 24 * HOUR)).toEqual({ httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 604800 });
    // __Host- rules: Secure, Path=/ and no Domain attribute.
    expect(sessionCookieOptions(1000)).not.toHaveProperty("domain");
  });

  it("is the only cookie the server reads a session from", async () => {
    const { sid } = await signedInOwner();
    const ok = await sessionGET(new Request(`${ORIGIN}/api/session`, { headers: hdrs({ cookie: `${SESSION_COOKIE}=${sid}` }) }), undefined);
    expect(ok.status).toBe(200);
    for (const name of ["cc_session", "__Secure-cc_session", "session"]) {
      const r = await sessionGET(new Request(`${ORIGIN}/api/session`, { headers: hdrs({ cookie: `${name}=${sid}` }) }), undefined);
      expect(r.status, name).toBe(401);
    }
  });

  it("parses cookie headers without letting a later duplicate override the first", () => {
    expect(parseCookieHeader("a=1; __Host-cc_session=x%2By; __Host-cc_session=evil").get(SESSION_COOKIE)).toBe("x+y");
  });
});

describe("ArchitectBot (e): Origin check failure returns 403", () => {
  it("originAllowed: safe methods pass; unsafe methods need a matching Origin", () => {
    expect(originAllowed("GET", hdrs({}))).toBe(true);
    expect(originAllowed("POST", hdrs({ origin: ORIGIN }))).toBe(true);
    expect(originAllowed("POST", hdrs({}))).toBe(false); // missing
    expect(originAllowed("POST", hdrs({ origin: "null" }))).toBe(false);
    expect(originAllowed("POST", hdrs({ origin: "https://evil.example" }))).toBe(false);
    expect(originAllowed("POST", hdrs({ origin: "https://cc.example.evil.example" }))).toBe(false);
    expect(originAllowed("DELETE", hdrs({ origin: "https://evil.example" }), ["https://evil.example"])).toBe(true); // configured
  });

  it("proxy answers 403 with no data for a cross-origin POST (pages, server actions, API)", async () => {
    for (const p of ["/", "/ideas/1", "/api/session", "/login"]) {
      const res = proxy(new NextRequest(`${ORIGIN}${p}`, { method: "POST", headers: hdrs({ origin: "https://evil.example", "next-action": "abc" }) }));
      expect(res.status, p).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    const noOrigin = proxy(new NextRequest(`${ORIGIN}/`, { method: "POST", headers: hdrs({}) }));
    expect(noOrigin.status).toBe(403);
  });

  it("logout answers 403 cross-origin and keeps the session", async () => {
    const { h, sid } = await signedInOwner();
    const res = await logoutPOST(new Request(`${ORIGIN}/logout`, { method: "POST", headers: hdrs({ origin: "https://evil.example", cookie: `${SESSION_COOKIE}=${sid}` }) }));
    expect(res.status).toBe(403);
    expect(h.auth.validateSession(sid)).not.toBeNull();
  });

  it("owner API routes answer 403 (not 401) on a bad Origin, even with a valid session", async () => {
    const { sid } = await signedInOwner();
    const POST = withOwnerApi(() => Response.json({ secret: "company data" }));
    const bad = await POST(new Request(`${ORIGIN}/api/x`, { method: "POST", headers: hdrs({ origin: "https://evil.example", cookie: `${SESSION_COOKIE}=${sid}` }) }), {});
    expect(bad.status).toBe(403);
    expect(await bad.text()).not.toContain("company data");
    const good = await POST(new Request(`${ORIGIN}/api/x`, { method: "POST", headers: hdrs({ origin: ORIGIN, cookie: `${SESSION_COOKIE}=${sid}` }) }), {});
    expect(good.status).toBe(200);
    expect(forbiddenJson().status).toBe(403);
  });
});

describe("AC1: not signed in means redirected to login and no data", () => {
  it("proxy redirects any page without a session cookie to /login?next=…, marked no-store", () => {
    for (const p of ["/", "/ideas/abc?x=1", "/decisions", "/account", "/enroll"]) {
      const res = proxy(new NextRequest(`${ORIGIN}${p}`, { headers: hdrs({}) }));
      expect(res.status, p).toBe(307);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.pathname).toBe("/login");
      expect(loc.searchParams.get("next")).toBe(p);
      expect(res.headers.get("cache-control")).toMatch(/no-store/);
    }
  });

  it("proxy answers 401 JSON for API calls without a session cookie, and lets /login through", async () => {
    const api = proxy(new NextRequest(`${ORIGIN}/api/session`, { headers: hdrs({}) }));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "unauthorized" });
    const login = proxy(new NextRequest(`${ORIGIN}/login`, { headers: hdrs({}) }));
    expect(login.headers.get("x-middleware-next")).toBe("1");
  });

  it("an API route returns 401 and no data for missing, unknown, expired or enrolment-only sessions", async () => {
    const { h, sid } = await signedInOwner();
    const call = (cookie?: string, auth?: string) =>
      sessionGET(new Request(`${ORIGIN}/api/session`, { headers: hdrs({ ...(cookie ? { cookie } : {}), ...(auth ? { authorization: auth } : {}) }) }), undefined);
    expect((await call()).status).toBe(401);
    expect((await call(`${SESSION_COOKIE}=${"A".repeat(43)}`)).status).toBe(401);
    // BR-02: a bearer token (bot credential) is ignored.
    expect((await call(undefined, `Bearer ${sid}`)).status).toBe(401);
    const ok = await call(`${SESSION_COOKIE}=${sid}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toMatch(/no-store/);
    h.advance(12 * HOUR);
    const expired = await call(`${SESSION_COOKIE}=${sid}`);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ error: "unauthorized" });

    const e = makeAuth();
    await setupOwner(e, { enrol: false });
    const r = await e.auth.login({ username: USERNAME, password: PASSWORD, ip: IP });
    setAuthForTests(e.auth);
    expect(r).toMatchObject({ ok: true, kind: "enrol" });
    expect((await call(`${SESSION_COOKIE}=${r.ok ? r.sessionId : ""}`)).status).toBe(401);
  });

  it("only same-site relative paths are accepted as the post-login destination", () => {
    expect(safeNextPath("/ideas/1?x=2")).toBe("/ideas/1?x=2");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/login", "", null]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});

describe("AC3: generic failure message", () => {
  it("never says which factor was wrong", () => {
    expect(SIGN_IN_FAILED).toBe("Sign-in failed");
    expect(throttledMessage(15 * 60_000)).toBe("Sign-in failed. Too many attempts: try again in 15 minutes.");
    for (const m of [SIGN_IN_FAILED, throttledMessage(1000)]) expect(m).not.toMatch(/user|password|code|2fa|totp/i);
  });
});

describe("ArchitectBot (a): polling and SSE requests do not slide the idle window", () => {
  it("recognises polling, SSE and prefetch requests", () => {
    expect(isBackgroundRequest(hdrs({ "x-cc-background": "1" }))).toBe(true);
    expect(isBackgroundRequest(hdrs({ accept: "text/event-stream" }))).toBe(true);
    expect(isBackgroundRequest(hdrs({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isBackgroundRequest(hdrs({ "sec-purpose": "prefetch" }))).toBe(true);
    expect(isBackgroundRequest(hdrs({ accept: "text/html" }))).toBe(false);
  });

  it("/api/session polling never extends the session; the poll reports it gone after 12 h", async () => {
    const { h, sid } = await signedInOwner();
    const before = lastSeen(h, sid);
    for (let i = 0; i < 11; i++) {
      h.advance(HOUR);
      const r = await sessionGET(new Request(`${ORIGIN}/api/session`, { headers: hdrs({ cookie: `${SESSION_COOKIE}=${sid}` }) }), undefined);
      expect(r.status).toBe(200);
    }
    expect(lastSeen(h, sid)).toBe(before);
    h.advance(HOUR);
    expect((await sessionGET(new Request(`${ORIGIN}/api/session`, { headers: hdrs({ cookie: `${SESSION_COOKIE}=${sid}` }) }), undefined)).status).toBe(401);
  });

  it("an SSE request to any owner API does not extend the session; a normal request does", async () => {
    const { h, sid } = await signedInOwner();
    const GET = withOwnerApi(() => new Response("data: hi\n\n", { headers: { "content-type": "text/event-stream" } }));
    const before = lastSeen(h, sid);
    h.advance(HOUR);
    const sse = await GET(new Request(`${ORIGIN}/api/events`, { headers: hdrs({ cookie: `${SESSION_COOKIE}=${sid}`, accept: "text/event-stream" }) }), {});
    expect(sse.status).toBe(200);
    expect(lastSeen(h, sid)).toBe(before);
    await GET(new Request(`${ORIGIN}/api/events`, { headers: hdrs({ cookie: `${SESSION_COOKIE}=${sid}` }) }), {});
    expect(lastSeen(h, sid)).not.toBe(before);
  });
});

describe("AC6: sign out ends the session and Back shows no cached data", () => {
  it("destroys the server session, expires the cookie and clears browser cache and storage", async () => {
    const { h, sid } = await signedInOwner();
    const res = await logoutPOST(new Request(`${ORIGIN}/logout`, { method: "POST", headers: hdrs({ origin: ORIGIN, cookie: `${SESSION_COOKIE}=${sid}` }) }));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(h.auth.validateSession(sid)).toBeNull();
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Host-cc_session=;/);
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Secure/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(res.headers.get("clear-site-data")).toContain('"cache"');
    // Replaying the old cookie after sign-out returns nothing.
    expect((await sessionGET(new Request(`${ORIGIN}/api/session`, { headers: hdrs({ cookie: `${SESSION_COOKIE}=${sid}` }) }), undefined)).status).toBe(401);
  });

  it("every response passing the proxy is marked no-store", () => {
    const res = proxy(new NextRequest(`${ORIGIN}/`, { headers: hdrs({ cookie: `${SESSION_COOKIE}=x` }) }));
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });
});

describe("throttling uses the proxy-appended client IP", () => {
  it("reads X-Forwarded-For from the right, ignoring client-supplied entries", () => {
    expect(clientIp(hdrs({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(hdrs({ "x-forwarded-for": "garbage<script>" }))).toBe("unknown");
  });
});
