import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CC-01 AC1: every page, server action and route handler checks the session itself
// (proxy.ts is only an early filter). This scan fails when a new route forgets its guard.

const APP = path.join(__dirname, "../app");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(path.relative(APP, p).split(path.sep).join("/"));
  }
  return out;
}
const files = walk(APP);
const read = (f: string) => fs.readFileSync(path.join(APP, f), "utf8");

/** Public by design: the login page itself, and enrolment (guarded by its own session check). */
const PUBLIC_PAGES: Record<string, RegExp> = {
  "login/page.tsx": /currentSession\(\)/,
  "enroll/page.tsx": /currentSession\(\)[\s\S]*if \(!s\) redirect\("\/login"\)/,
};
/** Public server actions: sign-in, and enrolment (auth.confirmEnrolment validates the session). */
const PUBLIC_ACTIONS: Record<string, string[]> = {
  "login/actions.ts": ["signIn"],
  "enroll/actions.ts": ["confirmEnrolment"],
};
/** Route handlers without withOwnerApi: sign-out (always allowed, Origin-checked). */
const PUBLIC_ROUTES: Record<string, RegExp> = { "logout/route.ts": /originAllowed\(/ };

describe("route protection (AC1)", () => {
  it("there is no sign-up page (BR-01)", () => {
    expect(files.filter((f) => /sign-?up|register|create-account/i.test(f))).toEqual([]);
  });

  it("every page calls requireOwner before reading any data", () => {
    const pages = files.filter((f) => /(^|\/)page\.tsx$/.test(f));
    expect(pages.length).toBeGreaterThan(3);
    for (const p of pages) {
      const src = read(p);
      if (PUBLIC_PAGES[p]) {
        expect(src, p).toMatch(PUBLIC_PAGES[p]!);
        expect(src, p).not.toMatch(/getData\(/);
        continue;
      }
      const guard = src.indexOf("await requireOwner(");
      expect(guard, `${p} must call requireOwner`).toBeGreaterThan(-1);
      const data = src.search(/getData\(|data\.\w+\./);
      if (data !== -1) expect(guard, `${p}: requireOwner must come before data access`).toBeLessThan(data);
    }
  });

  it("every exported server action checks the session first", () => {
    const actionFiles = files.filter((f) => /\.(ts|tsx)$/.test(f) && /^["']use server["']/m.test(read(f)));
    expect(actionFiles.length).toBeGreaterThan(2);
    for (const f of actionFiles) {
      const src = read(f);
      const fns = [...src.matchAll(/export async function (\w+)\s*\(/g)];
      expect(fns.length, f).toBeGreaterThan(0);
      fns.forEach((m, i) => {
        const name = m[1]!;
        const body = src.slice(m.index!, fns[i + 1]?.index ?? src.length);
        if (PUBLIC_ACTIONS[f]?.includes(name)) {
          expect(body, `${f}#${name}`).toMatch(/sameOrigin\(\)/);
          return;
        }
        const guard = body.indexOf("requireOwnerAction()");
        expect(guard, `${f}#${name} must call requireOwnerAction`).toBeGreaterThan(-1);
        const data = body.search(/getData\(|getAuth\(\)\.|cookies\(\)/);
        if (data !== -1) expect(guard, `${f}#${name}: guard before data`).toBeLessThan(data);
      });
    }
  });

  it("every route handler is wrapped in withOwnerApi (or is the Origin-checked sign-out)", () => {
    const routes = files.filter((f) => /(^|\/)route\.ts$/.test(f));
    expect(routes).toContain("api/session/route.ts");
    for (const r of routes) {
      const src = read(r);
      if (PUBLIC_ROUTES[r]) {
        expect(src, r).toMatch(PUBLIC_ROUTES[r]!);
        continue;
      }
      for (const m of src.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b(.*)/g)) {
        expect(m[2], `${r} ${m[1]}`).toMatch(/withOwnerApi\(/);
      }
    }
  });

  it("the proxy covers every path except static assets", () => {
    const src = fs.readFileSync(path.join(__dirname, "../proxy.ts"), "utf8");
    expect(src).toContain('matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]');
    expect(src).toMatch(/PUBLIC_PATHS = new Set\(\["\/login"\]\)/);
  });
});
