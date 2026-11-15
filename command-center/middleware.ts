import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// AUTH HOOK. TODO(Run B, CC-01): redirect unauthenticated requests to /login and return no
// data (AC1). Until then this allows local access to everything. Do NOT host this
// deployment publicly before Run B lands (BR-19).
// Note: Next.js 16 renamed this convention to proxy.ts; middleware.ts still works but is
// deprecated, so Run B should rename it when it implements the check.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
