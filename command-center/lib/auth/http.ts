// Framework-free HTTP helpers shared by proxy.ts, server actions and route handlers.
// Must not import the database (proxy.ts uses this).

export interface HeaderGetter {
  get(name: string): string | null;
}

/**
 * The one session cookie (ArchitectBot (b)). The __Host- prefix makes browsers require
 * Secure, Path=/ and no Domain, so no subdomain or plain-http page can set or shadow it.
 * Browsers treat http://localhost as a secure context, so this also works for local runs.
 */
export const SESSION_COOKIE = "__Host-cc_session";

const first = (v: string | null): string | null => (v ? v.split(",")[0]!.trim() : null);

export function requestHost(h: HeaderGetter): string | null {
  return first(h.get("x-forwarded-host")) ?? first(h.get("host"));
}

export function sessionCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: Math.max(0, Math.floor(maxAgeMs / 1000)),
  };
}

/**
 * ArchitectBot (a): requests the Owner did not make by hand must not slide the 12 h idle
 * window. Recognised: client polling (X-CC-Background: 1), SSE (Accept: text/event-stream)
 * and router prefetches (Next-Router-Prefetch, Purpose/Sec-Purpose: prefetch).
 */
export const BACKGROUND_HEADER = "x-cc-background";
export function isBackgroundRequest(h: HeaderGetter): boolean {
  if (h.get(BACKGROUND_HEADER) === "1") return true;
  if ((h.get("accept") ?? "").toLowerCase().includes("text/event-stream")) return true;
  if (h.get("next-router-prefetch")) return true;
  const purpose = `${h.get("sec-purpose") ?? ""} ${h.get("purpose") ?? ""}`.toLowerCase();
  return purpose.includes("prefetch");
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const isSafeMethod = (m: string): boolean => SAFE_METHODS.has(m.toUpperCase());

/**
 * CSRF origin check for state-changing requests (on top of SameSite=Strict cookies).
 * The Origin header must be present and match this host or an allowed origin.
 * A cross-site attacker cannot forge Origin or Host from a victim's browser.
 */
export function originAllowed(method: string, h: HeaderGetter, allowedOrigins: string[] = []): boolean {
  if (isSafeMethod(method)) return true;
  const origin = h.get("origin");
  if (!origin || origin === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (allowedOrigins.includes(parsed.origin)) return true;
  const host = requestHost(h);
  return !!host && parsed.host === host && (parsed.protocol === "https:" || parsed.protocol === "http:");
}

/** Only same-site relative paths are allowed as post-login destinations (no open redirect). */
export function safeNextPath(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || raw === "" || raw.length > 2048) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || /[\u0000-\u001f\\]/.test(raw)) return fallback;
  try {
    const u = new URL(raw, "http://cc.invalid");
    if (u.origin !== "http://cc.invalid") return fallback;
    if (u.pathname === "/login" || u.pathname === "/logout") return fallback;
    return u.pathname + u.search;
  } catch {
    return fallback;
  }
}

/**
 * Client IP for throttling. X-Forwarded-For is read from the RIGHT: with `hops` trusted
 * proxies in front (default 1: Vercel, or Next.js itself locally), the entry they appended
 * is the client. Left-most entries are client-controlled and never used.
 */
export function clientIp(h: HeaderGetter, hops = 1): string {
  const xff = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fromXff = hops > 0 && xff.length > 0 ? xff[Math.max(0, xff.length - hops)] : undefined;
  const raw = fromXff ?? h.get("x-real-ip")?.trim() ?? "";
  const ip = raw.toLowerCase().replace(/^::ffff:/, "").slice(0, 64);
  return /^[0-9a-f.:[\]]+$/.test(ip) ? ip : "unknown";
}

/** Minimal Cookie header parser (route handlers and proxy get raw headers). */
export function parseCookieHeader(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep raw */
    }
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

export const NO_STORE = "no-store, max-age=0";

export function unauthorizedJson(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "cache-control": NO_STORE },
  });
}

/** ArchitectBot (e): every failed Origin check answers 403, with no data. */
export function forbiddenJson(): Response {
  return new Response(JSON.stringify({ error: "forbidden" }), {
    status: 403,
    headers: { "content-type": "application/json", "cache-control": NO_STORE },
  });
}
