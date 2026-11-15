import { describe, expect, it } from "vitest";
import { ARGON2_PARAMS, hashPassword, needsRehash, passwordPolicyError, verifyPassword } from "../lib/auth/password";
import { RECOVERY_ALPHABET, formatRecoveryCode, generateRecoveryCodes, hashRecoveryCode, matchRecoveryCode, normalizeRecoveryCode } from "../lib/auth/recovery";
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totpAt, totpStep, verifyTotp } from "../lib/auth/totp";

describe("password hashing (argon2id, OWASP parameters)", () => {
  it("hashes with argon2id m=19 MiB, t=2, p=1 and a random salt", async () => {
    const h = await hashPassword("a long enough password");
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await hashPassword("a long enough password")).not.toBe(h); // salted
    expect(ARGON2_PARAMS.memoryCost).toBe(19456);
  });
  it("verifies the right password only and never throws on bad input", async () => {
    const h = await hashPassword("a long enough password");
    expect(await verifyPassword(h, "a long enough password")).toBe(true);
    expect(await verifyPassword(h, "a long enough passworD")).toBe(false);
    expect(await verifyPassword(h, "")).toBe(false);
    expect(await verifyPassword("not-a-hash", "a long enough password")).toBe(false);
    expect(await verifyPassword(h, "x".repeat(5000))).toBe(false);
  });
  it("flags hashes made with other parameters for rehash", async () => {
    expect(needsRehash(await hashPassword("a long enough password"))).toBe(false);
    expect(needsRehash("$argon2id$v=19$m=4096,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA")).toBe(true);
    expect(needsRehash("garbage")).toBe(true);
  });
  it("enforces a minimum length", () => {
    expect(passwordPolicyError("short")).toMatch(/at least 12/);
    expect(passwordPolicyError(" padded password ")).toMatch(/whitespace/);
    expect(passwordPolicyError("twelve chars!")).toBeNull();
  });
});

describe("TOTP (RFC 6238: SHA-1, 6 digits, 30 s)", () => {
  // RFC 6238 Appendix B test secret "12345678901234567890" (ASCII).
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC 6238 / RFC 4226 test vectors", () => {
    expect(hotp(Buffer.from("12345678901234567890"), 0)).toBe("755224"); // RFC 4226 Appendix D
    expect(hotp(Buffer.from("12345678901234567890"), 9)).toBe("520489");
    expect(totpAt(rfcSecret, 59_000, 8)).toBe("94287082");
    expect(totpAt(rfcSecret, 1111111109_000, 8)).toBe("07081804");
    expect(totpAt(rfcSecret, 20000000000_000, 8)).toBe("65353130");
    expect(totpAt(rfcSecret, 59_000)).toBe("287082");
  });
  it("accepts the previous and next step (±30 s skew) but not ±2 steps", () => {
    const s = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(s, totpAt(s, now), now)).toBe(step);
    expect(verifyTotp(s, totpAt(s, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(s, totpAt(s, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(s, totpAt(s, now - 60_000), now)).toBeNull();
    expect(verifyTotp(s, totpAt(s, now + 60_000), now)).toBeNull();
  });
  it("rejects a code whose step was already used (replay within its window)", () => {
    const s = generateTotpSecret();
    const now = 1_800_000_000_000;
    const code = totpAt(s, now);
    const step = verifyTotp(s, code, now)!;
    expect(verifyTotp(s, code, now, step)).toBeNull(); // same code again
    expect(verifyTotp(s, code, now + 25_000, step)).toBeNull(); // still inside skew window
    expect(verifyTotp(s, totpAt(s, now - 30_000), now, step)).toBeNull(); // older step
    expect(verifyTotp(s, totpAt(s, now + 30_000), now + 30_000, step)).toBe(step + 1); // next code is fine
  });
  it("rejects malformed codes and secrets", () => {
    const s = generateTotpSecret();
    expect(verifyTotp(s, "12345", 0)).toBeNull();
    expect(verifyTotp(s, "abcdef", 0)).toBeNull();
    expect(verifyTotp("!!!", "123456", 0)).toBeNull();
  });
  it("generates 160-bit secrets, round-trips base32 and builds a local otpauth URI", () => {
    const s = generateTotpSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(base32Encode(base32Decode(s))).toBe(s);
    const uri = otpauthUri(s, "owner");
    expect(uri).toMatch(/^otpauth:\/\/totp\/Command%20Center%3Aowner\?/);
    expect(uri).toContain(`secret=${s}`);
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

describe("recovery codes", () => {
  it("AC3b / ArchitectBot (d): 10 distinct codes, each 10 base32 characters shown as xxxxx-xxxxx", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
      expect(c.replace("-", "")).toHaveLength(10);
    }
    // Uses the whole RFC 4648 alphabet (sanity check over many codes).
    const chars = new Set(generateRecoveryCodes(200).join("").replace(/-/g, ""));
    expect([...chars].every((ch) => RECOVERY_ALPHABET.includes(ch))).toBe(true);
    expect(chars.size).toBe(32);
    expect(formatRecoveryCode("abcdefghij")).toBe("abcde-fghij");
  });
  it("stores only argon2id hashes and matches leniently formatted input", async () => {
    const [code] = generateRecoveryCodes(1);
    const h = await hashRecoveryCode(code!);
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(h).not.toContain(code!.replace(/-/g, ""));
    expect(await matchRecoveryCode(code!.toUpperCase().replace(/-/g, " "), [{ id: 7, code_hash: h }])).toBe(7);
    expect(await matchRecoveryCode(code!.replace("-", ""), [{ id: 7, code_hash: h }])).toBe(7);
    expect(await matchRecoveryCode("aaaaa-aaaaa", [{ id: 7, code_hash: h }])).toBeNull();
  });
  it("rejects malformed codes and reads look-alike digits as letters", () => {
    expect(normalizeRecoveryCode("short")).toBeNull();
    expect(normalizeRecoveryCode("abcde-fghijk")).toBeNull(); // 11 chars
    expect(normalizeRecoveryCode("abcde-fgh9j")).toBeNull(); // 9 is not base32
    expect(normalizeRecoveryCode("123456")).toBeNull(); // a TOTP code is never a recovery code
    expect(normalizeRecoveryCode("0BCDE-1GH8J")).toBe("obcdelghbj");
  });
});
