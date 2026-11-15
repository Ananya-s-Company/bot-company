import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ABSOLUTE_TIMEOUT_MS, IDLE_TIMEOUT_MS, IP_LOCKOUT_MS, resolveAuthConfig } from "../lib/auth/config";
import { clockNow } from "../lib/test-overrides";

describe("BR-19 / AC3a: 2FA is mandatory on any hosted deployment", () => {
  it("password-only is off by default, locally and hosted", () => {
    expect(resolveAuthConfig({}).allowPasswordOnly).toBe(false);
    expect(resolveAuthConfig({ CC_HOSTED: "1" }).allowPasswordOnly).toBe(false);
  });

  it("a Vercel deployment counts as hosted even without CC_HOSTED, so the local flag is ignored", () => {
    const c = resolveAuthConfig({ VERCEL: "1", CC_ALLOW_PASSWORD_ONLY: "1" });
    expect(c).toMatchObject({ hosted: true, allowPasswordOnly: false, passwordOnlyIgnored: true });
  });

  it("only an explicit local flag enables password-only", () => {
    expect(resolveAuthConfig({ CC_ALLOW_PASSWORD_ONLY: "1" })).toMatchObject({ hosted: false, allowPasswordOnly: true });
    expect(resolveAuthConfig({ CC_ALLOW_PASSWORD_ONLY: "0" }).allowPasswordOnly).toBe(false);
  });
});

describe("AC4 / AC5 / AC5a policy values cannot be weakened outside tests", () => {
  const shortened = { CC_TEST_IDLE_MS: "1", CC_TEST_ABSOLUTE_MS: "1", CC_TEST_LOCKOUT_MS: "1", CC_TEST_NOW: "2000-01-01T00:00:00Z" };

  it("uses 12 h idle, 7 days absolute and a 15 min block in development and production", () => {
    for (const NODE_ENV of ["development", "production", undefined]) {
      const c = resolveAuthConfig({ NODE_ENV, ...shortened });
      expect(c.idleMs).toBe(IDLE_TIMEOUT_MS);
      expect(c.absoluteMs).toBe(ABSOLUTE_TIMEOUT_MS);
      expect(c.throttle.ipLockoutMs).toBe(IP_LOCKOUT_MS);
      expect(clockNow({ NODE_ENV, ...shortened }).getUTCFullYear()).toBeGreaterThan(2000);
    }
    expect(IDLE_TIMEOUT_MS).toBe(12 * 3600_000);
    expect(ABSOLUTE_TIMEOUT_MS).toBe(7 * 24 * 3600_000);
    expect(IP_LOCKOUT_MS).toBe(15 * 60_000);
  });

  it("honours the overrides only under NODE_ENV=test", () => {
    const c = resolveAuthConfig({ NODE_ENV: "test", ...shortened });
    expect(c.idleMs).toBe(1);
    expect(clockNow({ NODE_ENV: "test", ...shortened }).toISOString()).toBe("2000-01-01T00:00:00.000Z");
  });
});

describe("AC7: no email reset flow; host admin commands only", () => {
  const root = path.join(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };

  it("there is no forgot/reset-password route in the app", () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const routes = walk(path.join(root, "app")).map((f) => path.relative(root, f));
    expect(routes.filter((f) => /forgot|reset|recover-password|password-reset/i.test(f))).toEqual([]);
  });

  it("no mail library is installed", () => {
    expect(Object.keys(pkg.dependencies).filter((d) => /mail|smtp|sendgrid|resend|postmark/i.test(d))).toEqual([]);
  });

  it("password reset, 2FA reset and unlock are npm scripts run on the host", () => {
    expect(pkg.scripts["admin:set-password"]).toMatch(/scripts\/admin-set-password\.ts/);
    expect(pkg.scripts["admin:reset-2fa"]).toMatch(/scripts\/admin-reset-2fa\.ts/);
    expect(pkg.scripts["admin:unlock"]).toMatch(/scripts\/admin-unlock\.ts/);
    for (const s of ["admin-set-password", "admin-reset-2fa", "admin-unlock"]) {
      expect(fs.existsSync(path.join(root, "scripts", `${s}.ts`))).toBe(true);
    }
  });
});
