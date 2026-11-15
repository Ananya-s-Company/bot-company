import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { forbiddenJson, NO_STORE, SESSION_COOKIE, originAllowed, parseCookieHeader, sessionCookieOptions } from "@/lib/auth/http";

// AC6: Sign out destroys the server-side session, clears the cookie and asks the browser
// to drop cached pages and page storage (including unsaved drafts), so Back shows no data.
// POST only and same-origin only (403 otherwise). Needs no session (signing out is always allowed).
export async function POST(request: Request): Promise<Response> {
  const auth = getAuth();
  if (!originAllowed("POST", request.headers, auth.config.allowedOrigins)) return forbiddenJson();
  auth.logout(parseCookieHeader(request.headers.get("cookie")).get(SESSION_COOKIE));
  const res = NextResponse.redirect(new URL("/login", request.url), 303);
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  res.headers.set("cache-control", NO_STORE);
  res.headers.set("clear-site-data", '"cache", "storage"');
  return res;
}
