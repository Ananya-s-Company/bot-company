import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { NO_STORE, SESSION_COOKIE, forbiddenJson, originAllowed, unauthorizedJson } from "./lib/auth/http";
import { loadAuthConfig } from "./lib/auth/config";

// CC-01 proxy (Next.js 16 name for middleware). An early filter only:
//  - CSRF: state-changing requests must carry a matching Origin header.
//  - Requests without any session cookie never reach a page or API (AC1).
//  - Every response is marked no-store so Back after sign-out shows nothing cached (AC6).
// The authoritative session check happens server-side in every page, server action and
// route handler (lib/auth), because a proxy matcher can silently miss routes.

const PUBLIC_PATHS = new Set(["/login"]);
const allowedOrigins = loadAuthConfig().allowedOrigins;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // ArchitectBot (e): a failed Origin check is always 403, before anything else runs.
  if (!originAllowed(request.method, request.headers, allowedOrigins)) return forbiddenJson();

  const hasCookie = request.cookies.has(SESSION_COOKIE);
  // Server actions authenticate themselves and answer with a re-auth result, which lets
  // a form keep unsaved input when the session expired mid-action.
  const isServerAction = request.method === "POST" && request.headers.has("next-action");

  if (!PUBLIC_PATHS.has(pathname) && !hasCookie && !isServerAction) {
    if (pathname.startsWith("/api/")) return unauthorizedJson();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    const res = NextResponse.redirect(url, request.method === "GET" || request.method === "HEAD" ? 307 : 303);
    res.headers.set("cache-control", NO_STORE);
    return res;
  }

  const res = NextResponse.next();
  res.headers.set("cache-control", NO_STORE);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
