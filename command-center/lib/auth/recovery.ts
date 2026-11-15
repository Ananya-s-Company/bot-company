import { randomInt } from "node:crypto";
import { RECOVERY_CODE_COUNT } from "./config";
import { hashPassword, verifyPassword } from "./password";

// Recovery codes (CC-01 AC3b, ArchitectBot (d)). Each code is 10 random characters from
// the RFC 4648 base32 alphabet (a-z, 2-7: 50 bits), shown as xxxxx-xxxxx. Only argon2id
// hashes (same OWASP parameters as the password, random salt each) are stored, so a leaked
// database does not yield usable codes. Codes are shown once, at enrolment or regeneration.

export const RECOVERY_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"; // RFC 4648 base32, lower case
export const RECOVERY_CODE_LENGTH = 10;
const GROUP_LEN = 5;

/** Display form: xxxxx-xxxxx. */
export const formatRecoveryCode = (raw: string): string => `${raw.slice(0, GROUP_LEN)}-${raw.slice(GROUP_LEN)}`;

export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < n) {
    let s = "";
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    codes.add(formatRecoveryCode(s));
  }
  return [...codes];
}

/**
 * Canonical form for hashing and matching: lower case, spaces and dashes removed, and the
 * digits 0, 1 and 8 (not in base32) read as the letters they are mistaken for. Null if malformed.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toLowerCase().replace(/[\s-]/g, "").replace(/0/g, "o").replace(/1/g, "l").replace(/8/g, "b");
  if (s.length !== RECOVERY_CODE_LENGTH) return null;
  for (const ch of s) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  return s;
}

export const looksLikeRecoveryCode = (input: string): boolean => normalizeRecoveryCode(input) !== null;

export async function hashRecoveryCode(code: string): Promise<string> {
  const n = normalizeRecoveryCode(code);
  if (!n) throw new Error("Invalid recovery code format");
  return hashPassword(n);
}

/**
 * Returns the id of the matching unused code, or null. Every candidate is checked (no
 * early exit) so timing does not reveal the position of a match.
 */
export async function matchRecoveryCode(input: string, candidates: { id: number; code_hash: string }[]): Promise<number | null> {
  const n = normalizeRecoveryCode(input);
  if (!n) return null;
  let found: number | null = null;
  for (const c of candidates) {
    if ((await verifyPassword(c.code_hash, n)) && found === null) found = c.id;
  }
  return found;
}
