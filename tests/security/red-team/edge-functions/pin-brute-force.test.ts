/**
 * SEC-01 -- PIN Brute Force via Weak Legacy Hash
 *
 * Target: supabase/functions/_shared/crypto.ts
 *         supabase/functions/badge-events/_shared/helpers.ts
 *
 * Vulnerability:
 *   The legacy hashPin function uses SHA-256 with a FIXED salt "badgeuse_salt_v1".
 *   A 4-digit PIN has only 10,000 possibilities (0000-9999).
 *   An attacker with a stolen hash can brute-force the PIN in <1 second.
 *
 *   While PBKDF2 has been introduced as the new default, the legacy SHA-256
 *   path is still accepted by verifyPin() and legacy hashes remain in the DB
 *   until transparent migration occurs (on next successful login).
 *
 * PoC:
 *   1. Confirm SHA-256 is used with a fixed salt in the legacy hashPin
 *   2. Confirm the fixed salt value "badgeuse_salt_v1"
 *   3. Demonstrate that a rainbow table of all 10,000 PINs fits in memory
 *   4. Confirm verifyPin still accepts legacy SHA-256 hashes (migration window)
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";
import { createHash } from "crypto";

describe("SEC-01: PIN Brute Force via Weak Legacy Hash", () => {
  let cryptoSource: string;
  let helpersSource: string;

  it("should read the crypto and helpers source files", async () => {
    cryptoSource = await readSourceFile("supabase/functions/_shared/crypto.ts");
    helpersSource = await readSourceFile("supabase/functions/badge-events/_shared/helpers.ts");
    expect(cryptoSource.length).toBeGreaterThan(0);
    expect(helpersSource.length).toBeGreaterThan(0);
  });

  it("should confirm legacy hashPin uses SHA-256 (not bcrypt/argon2/scrypt)", async () => {
    const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
    // The legacy hashPin function uses crypto.subtle.digest("SHA-256", ...)
    const sha256Matches = findInSource(source, /SHA-256/g);
    expect(sha256Matches.length).toBeGreaterThan(0);

    // The legacy hashPin function exists and is exported
    const hashPinExport = findInSource(source, /export async function hashPin/g);
    expect(hashPinExport.length).toBeGreaterThan(0);
  });

  it("should confirm the fixed salt 'badgeuse_salt_v1' is hardcoded", async () => {
    const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
    const saltMatches = findInSource(source, /badgeuse_salt_v1/g);
    expect(saltMatches.length).toBeGreaterThan(0);
  });

  it("should confirm hashPin concatenates pin + fixed salt (no per-user salt)", async () => {
    const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
    // The pattern: encoder.encode(pin + "badgeuse_salt_v1")
    const concatPattern = findInSource(source, /encoder\.encode\(pin\s*\+\s*"badgeuse_salt_v1"\)/g);
    expect(concatPattern.length).toBeGreaterThan(0);
  });

  it("should confirm verifyPin still accepts legacy SHA-256 format (migration window)", async () => {
    const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
    // verifyPin checks for legacy 64-char hex (SHA-256 output)
    // It falls through to: const sha256Hash = await hashPin(pin); return sha256Hash === storedHash;
    const legacyFallback = findInSource(source, /const sha256Hash = await hashPin\(pin\)/g);
    expect(legacyFallback.length).toBeGreaterThan(0);
  });

  it("should compute a rainbow table of all 10,000 4-digit PINs in <1 second", () => {
    const FIXED_SALT = "badgeuse_salt_v1";
    const rainbowTable = new Map<string, string>();

    const startTime = performance.now();

    for (let i = 0; i <= 9999; i++) {
      const pin = i.toString().padStart(4, "0");
      const hash = createHash("sha256")
        .update(pin + FIXED_SALT)
        .digest("hex");
      rainbowTable.set(hash, pin);
    }

    const elapsedMs = performance.now() - startTime;

    // All 10,000 PINs should be in the table
    expect(rainbowTable.size).toBe(10000);

    // Should complete in well under 1 second
    expect(elapsedMs).toBeLessThan(1000);

    // Demonstrate lookup: given a hash, find the PIN instantly
    const testPin = "1234";
    const testHash = createHash("sha256")
      .update(testPin + FIXED_SALT)
      .digest("hex");
    expect(rainbowTable.get(testHash)).toBe("1234");

    // Another PIN
    const testPin2 = "0000";
    const testHash2 = createHash("sha256")
      .update(testPin2 + FIXED_SALT)
      .digest("hex");
    expect(rainbowTable.get(testHash2)).toBe("0000");
  });

  it("should confirm helpers.ts re-exports the legacy hashPin (still accessible)", async () => {
    const source = await readSourceFile("supabase/functions/badge-events/_shared/helpers.ts");
    // helpers.ts imports and re-exports hashPin from _shared/crypto.ts
    const reExport = findInSource(source, /export const hashPin/g);
    expect(reExport.length).toBeGreaterThan(0);
  });

  it("should confirm legacy hashPin is marked @deprecated but NOT removed", async () => {
    const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
    // The function is deprecated but still callable
    const deprecated = findInSource(source, /@deprecated.*hashPin|hashPin.*@deprecated/gi);
    expect(deprecated.length).toBeGreaterThan(0);

    // But the function body still exists (not stubbed out)
    const functionBody = findInSource(source, /export async function hashPin\(pin: string\)/g);
    expect(functionBody.length).toBe(1);
  });
});
