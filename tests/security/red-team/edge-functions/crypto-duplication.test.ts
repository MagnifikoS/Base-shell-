/**
 * CRYPTO-01 -- Crypto Function Duplication Analysis
 *
 * Target: Files containing hashPin function
 *
 * Finding:
 *   The hashPin function was previously duplicated across multiple files.
 *   The codebase has been partially remediated:
 *
 *   - _shared/crypto.ts is now the SSOT for hashPin, hashPinPbkdf2, verifyPin
 *   - badge-events/_shared/helpers.ts re-exports from _shared/crypto.ts
 *     (delegation, not duplication)
 *   - badge-pin/index.ts imports from _shared/crypto.ts
 *
 *   This test verifies:
 *   1. The SSOT pattern (one canonical implementation)
 *   2. Delegation (not duplication) in helpers.ts
 *   3. The fixed salt "badgeuse_salt_v1" exists only in _shared/crypto.ts
 *   4. All files that use hashPin ultimately delegate to the SSOT
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("CRYPTO-01: Crypto Function Duplication Analysis", () => {
  it("should find all files that reference hashPin", async () => {
    const allTsFiles = await globSourceFiles("supabase/functions/**/*.ts");
    const filesWithHashPin: string[] = [];

    for (const filePath of allTsFiles) {
      const source = await readSourceFile(filePath);
      if (findInSource(source, /hashPin/g).length > 0) {
        filesWithHashPin.push(filePath);
      }
    }

    // Should find files referencing hashPin
    expect(filesWithHashPin.length).toBeGreaterThanOrEqual(3);
  });

  it("should confirm _shared/crypto.ts is the SSOT with the actual implementation", async () => {
    const source = await readSourceFile("supabase/functions/_shared/crypto.ts");

    // Should have the actual hashPin implementation (not a re-export)
    const hashPinImpl = findInSource(source, /export async function hashPin\(pin: string\)/g);
    expect(hashPinImpl.length).toBe(1);

    // Should have the fixed salt in the implementation
    const saltUsage = findInSource(source, /badgeuse_salt_v1/g);
    expect(saltUsage.length).toBeGreaterThan(0);

    // Should have crypto.subtle.digest("SHA-256", ...)
    const sha256Usage = findInSource(source, /crypto\.subtle\.digest\("SHA-256"/g);
    expect(sha256Usage.length).toBeGreaterThan(0);
  });

  it("should confirm helpers.ts delegates to _shared/crypto.ts (not duplicating)", async () => {
    const source = await readSourceFile("supabase/functions/badge-events/_shared/helpers.ts");

    // Should import from _shared/crypto.ts
    const importFromCrypto = findInSource(
      source,
      /import.*hashPin.*from\s+["']\.\.\/\.\.\/_shared\/crypto/g
    );
    expect(importFromCrypto.length).toBe(1);

    // Should re-export as a const (delegation)
    const reExport = findInSource(source, /export const hashPin = _sharedHashPin/g);
    expect(reExport.length).toBe(1);

    // Should NOT have its own crypto.subtle.digest call for hashPin
    const ownDigest = findInSource(source, /crypto\.subtle\.digest\("SHA-256"/g);
    expect(ownDigest.length).toBe(0);
  });

  it("should confirm badge-pin/index.ts imports from _shared/crypto.ts", async () => {
    const source = await readSourceFile("supabase/functions/badge-pin/index.ts");

    // Should import hashPinPbkdf2 from _shared/crypto.ts
    const importFromCrypto = findInSource(
      source,
      /import.*hashPinPbkdf2.*from\s+["']\.\.\/_shared\/crypto/g
    );
    expect(importFromCrypto.length).toBe(1);
  });

  it("should confirm the fixed salt 'badgeuse_salt_v1' appears only in _shared/crypto.ts", async () => {
    const allTsFiles = await globSourceFiles("supabase/functions/**/*.ts");
    const filesWithSalt: string[] = [];

    for (const filePath of allTsFiles) {
      const source = await readSourceFile(filePath);
      if (findInSource(source, /badgeuse_salt_v1/g).length > 0) {
        filesWithSalt.push(filePath);
      }
    }

    // The fixed salt should only be in the SSOT file
    expect(filesWithSalt.length).toBe(1);
    expect(filesWithSalt[0]).toContain("_shared/crypto.ts");
  });

  it("should confirm PBKDF2 is the new recommended method (but legacy still exists)", async () => {
    const source = await readSourceFile("supabase/functions/_shared/crypto.ts");

    // PBKDF2 implementation exists
    const pbkdf2Impl = findInSource(source, /export async function hashPinPbkdf2/g);
    expect(pbkdf2Impl.length).toBe(1);

    // PBKDF2 uses random salt (per-hash, not fixed)
    const randomSalt = findInSource(source, /crypto\.getRandomValues/g);
    expect(randomSalt.length).toBeGreaterThan(0);

    // PBKDF2 uses 100,000 iterations
    const iterations = findInSource(source, /PBKDF2_ITERATIONS\s*=\s*100_000/g);
    expect(iterations.length).toBe(1);

    // But legacy hashPin is NOT removed (still a risk during migration window)
    const legacyExists = findInSource(source, /export async function hashPin\(pin: string\)/g);
    expect(legacyExists.length).toBe(1);
  });

  it("should confirm verifyPin supports all 3 formats (migration path)", async () => {
    const source = await readSourceFile("supabase/functions/_shared/crypto.ts");

    // Format 1: PBKDF2 (appears in verifyPin dispatch + verifyPinPbkdf2 guard)
    const pbkdf2Check = findInSource(source, /storedHash\.startsWith\("pbkdf2:"\)/g);
    expect(pbkdf2Check.length).toBeGreaterThanOrEqual(1);

    // Format 2: bcrypt
    const bcryptCheck = findInSource(source, /storedHash\.startsWith\("\$2a\$"\)/g);
    expect(bcryptCheck.length).toBe(1);

    // Format 3: Legacy SHA-256 (fallback)
    const sha256Fallback = findInSource(source, /const sha256Hash = await hashPin\(pin\)/g);
    expect(sha256Fallback.length).toBe(1);
  });

  it("should confirm pinHashNeedsRehash identifies non-PBKDF2 hashes", async () => {
    const source = await readSourceFile("supabase/functions/_shared/crypto.ts");

    const needsRehash = findInSource(source, /export function pinHashNeedsRehash/g);
    expect(needsRehash.length).toBe(1);

    // It checks if the hash does NOT start with "pbkdf2:"
    const notPbkdf2 = findInSource(source, /!storedHash\.startsWith\("pbkdf2:"\)/g);
    expect(notPbkdf2.length).toBe(1);
  });
});
