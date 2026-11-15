import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// TOTP (RFC 6238) over HOTP (RFC 4226): HMAC-SHA1, 30 s steps, 6 digits. Everything is
// computed locally; no external service is involved.

export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous and next step to tolerate small clock skew (±30 s). */
export const TOTP_SKEW_STEPS = 1;
export const TOTP_ISSUER = "Command Center";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret (RFC 4226 recommends at least 128, SHA-1 block suggests 160). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) | ((mac[offset + 1]! & 0xff) << 16) | ((mac[offset + 2]! & 0xff) << 8) | (mac[offset + 3]! & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const totpStep = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_PERIOD_S);

export function totpAt(secretB32: string, nowMs: number, digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretB32), totpStep(nowMs), digits);
}

export const looksLikeTotp = (code: string): boolean => new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code);

/**
 * Returns the matched time step, or null. Checks every step in the window (±skew) with a
 * constant-time compare. Replay protection: a step at or before `lastUsedStep` is never
 * accepted, so a code cannot be reused within its window. The caller persists the
 * returned step atomically (see service.ts).
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  nowMs: number,
  lastUsedStep: number | null = null,
  skew = TOTP_SKEW_STEPS,
): number | null {
  if (!looksLikeTotp(code)) return null;
  let key: Buffer;
  try {
    key = base32Decode(secretB32);
  } catch {
    return null;
  }
  const now = totpStep(nowMs);
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (let s = now - skew; s <= now + skew; s++) {
    const fresh = lastUsedStep === null || s > lastUsedStep;
    if (timingSafeEqual(Buffer.from(hotp(key, s)), given) && fresh && matched === null) matched = s;
  }
  return matched;
}

export function otpauthUri(secretB32: string, account: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${account}`);
  const q = new URLSearchParams({
    secret: secretB32,
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_S),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
