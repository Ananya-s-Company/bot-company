// Auth configuration (CC-01). Read from the environment; every variable is documented in
// .env.example. Pure functions so tests can pass their own env. No database imports
// (proxy.ts uses this module).
import { durationMs } from "../test-overrides";

type Env = Record<string, string | undefined>;

export interface AuthConfig {
  /** Hosted (non-local) deployment. Forces 2FA (BR-19). */
  hosted: boolean;
  /** Effective password-only permission: the local flag, and never in hosted mode. */
  allowPasswordOnly: boolean;
  /** CC_ALLOW_PASSWORD_ONLY was set but ignored because hosted mode is on. */
  passwordOnlyIgnored: boolean;
  /** Extra origins accepted by the CSRF origin check; empty = the request's own host. */
  allowedOrigins: string[];
  /** How many proxies append to X-Forwarded-For in front of the app (client IP = entry hops from the right). */
  trustedProxyHops: number;
  idleMs: number;
  absoluteMs: number;
  enrolMs: number;
  throttle: {
    /** Failures per IP inside the window before further attempts from it are blocked. */
    ipMaxFailures: number;
    ipWindowMs: number;
    /** AC4: once the limit is hit, how long that IP stays blocked (from its latest failure). */
    ipLockoutMs: number;
    /** Account-wide exponential backoff: base * 2^(n-1) after n consecutive failures, capped. */
    backoffBaseMs: number;
    backoffMaxMs: number;
  };
}

const truthy = (v: string | undefined) => v != null && /^(1|true|yes|on)$/i.test(v.trim());

// Policy defaults (head-of-tech decisions; see README "Security decisions").
export const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // AC5
export const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // AC5a
export const ENROL_TIMEOUT_MS = 30 * 60 * 1000; // restricted "finish 2FA setup" session
export const IP_MAX_FAILURES = 5;
export const IP_WINDOW_MS = 15 * 60 * 1000;
export const IP_LOCKOUT_MS = 15 * 60 * 1000;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60 * 1000;
export const RECOVERY_CODE_COUNT = 10;

export function resolveAuthConfig(env: Env = process.env): AuthConfig {
  const hosted = truthy(env.CC_HOSTED) || env.VERCEL === "1";
  const wantsPasswordOnly = truthy(env.CC_ALLOW_PASSWORD_ONLY);
  const hops = Number(env.CC_TRUSTED_PROXY_HOPS ?? "1");
  return {
    hosted,
    // BR-19: hosted mode always requires 2FA, whatever the password-only flag says.
    allowPasswordOnly: wantsPasswordOnly && !hosted,
    passwordOnlyIgnored: wantsPasswordOnly && hosted,
    allowedOrigins: (env.CC_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    trustedProxyHops: Number.isInteger(hops) && hops >= 0 && hops <= 10 ? hops : 1,
    // Durations are overridable in NODE_ENV=test only (lib/test-overrides.ts).
    idleMs: durationMs("CC_TEST_IDLE_MS", IDLE_TIMEOUT_MS, env),
    absoluteMs: durationMs("CC_TEST_ABSOLUTE_MS", ABSOLUTE_TIMEOUT_MS, env),
    enrolMs: durationMs("CC_TEST_ENROL_MS", ENROL_TIMEOUT_MS, env),
    throttle: {
      ipMaxFailures: IP_MAX_FAILURES,
      ipWindowMs: durationMs("CC_TEST_THROTTLE_WINDOW_MS", IP_WINDOW_MS, env),
      ipLockoutMs: durationMs("CC_TEST_LOCKOUT_MS", IP_LOCKOUT_MS, env),
      backoffBaseMs: durationMs("CC_TEST_BACKOFF_BASE_MS", BACKOFF_BASE_MS, env),
      backoffMaxMs: durationMs("CC_TEST_BACKOFF_MAX_MS", BACKOFF_MAX_MS, env),
    },
  };
}

export const loadAuthConfig = (): AuthConfig => resolveAuthConfig(process.env);
