// Clock and duration overrides for automated tests. They take effect ONLY when
// NODE_ENV is "test" (vitest sets it); in development and production they are ignored,
// so a stray env var can never shorten a session or weaken throttling on a real run.
// Documented in .env.example.

type Env = Record<string, string | undefined>;

export const isTestEnv = (env: Env = process.env): boolean => env.NODE_ENV === "test";

/** Raw override value, or undefined outside NODE_ENV=test. */
export function testOverride(name: string, env: Env = process.env): string | undefined {
  return isTestEnv(env) ? env[name] : undefined;
}

/** A duration in milliseconds: the default unless a valid test override is set. */
export function durationMs(name: string, defaultMs: number, env: Env = process.env): number {
  const raw = testOverride(name, env);
  if (raw == null || raw.trim() === "") return defaultMs;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaultMs;
}

/** Current time. CC_TEST_NOW (ISO timestamp) pins the clock in tests only. */
export function clockNow(env: Env = process.env): Date {
  const raw = testOverride("CC_TEST_NOW", env);
  if (raw) {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return new Date();
}

/**
 * CC-21 daily update cutoff, 6:00 PM America/Toronto (OQ-6). CC_TEST_DAILY_CUTOFF ("HH:MM",
 * 24h) overrides it in tests only. Consumed by the updates feed epic (E2).
 */
export function dailyCutoff(env: Env = process.env): { hour: number; minute: number; timeZone: "America/Toronto" } {
  const def = { hour: 18, minute: 0, timeZone: "America/Toronto" as const };
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(testOverride("CC_TEST_DAILY_CUTOFF", env)?.trim() ?? "");
  return m ? { ...def, hour: Number(m[1]), minute: Number(m[2]) } : def;
}
