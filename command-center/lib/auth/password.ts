import { hash, parseOptions, verify, type Algorithm } from "@node-rs/argon2";

// Argon2id with the OWASP Password Storage Cheat Sheet baseline: m=19 MiB, t=2, p=1.
// `Algorithm` is a const enum in the typings, which isolatedModules cannot inline, so the
// numeric value is used directly (2 = Argon2id).
const ARGON2ID = 2 as Algorithm;
export const ARGON2_PARAMS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 1024;

/** Returns an error message, or null when the password is acceptable. */
export function passwordPolicyError(pw: string): string | null {
  if (pw.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (pw.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (pw.trim() !== pw) return "Password must not start or end with whitespace.";
  return null;
}

export function hashPassword(pw: string): Promise<string> {
  return hash(pw, ARGON2_PARAMS);
}

/** Never throws: a malformed stored hash is treated as a mismatch. */
export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  if (pw.length === 0 || pw.length > PASSWORD_MAX_LENGTH) {
    // Still spend comparable time so length is not a timing oracle.
    await verify(await dummyHash(), "x".repeat(PASSWORD_MIN_LENGTH)).catch(() => false);
    return false;
  }
  try {
    return await verify(stored, pw);
  } catch {
    return false;
  }
}

/** True if the stored hash was made with weaker or different parameters than the current policy. */
export function needsRehash(stored: string): boolean {
  try {
    const o = parseOptions(stored);
    return (
      o.algorithm !== ARGON2_PARAMS.algorithm ||
      o.memoryCost !== ARGON2_PARAMS.memoryCost ||
      o.timeCost !== ARGON2_PARAMS.timeCost ||
      o.parallelism !== ARGON2_PARAMS.parallelism
    );
  } catch {
    return true;
  }
}

let dummy: Promise<string> | undefined;
/** A real hash of a random value, verified against when no account exists (equal timing). */
export function dummyHash(): Promise<string> {
  return (dummy ??= hash(crypto.randomUUID(), ARGON2_PARAMS));
}
