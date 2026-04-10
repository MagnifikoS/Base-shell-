/**
 * SEC-01: PIN Hashing Assessment
 *
 * Verifies that PIN hashing uses a strong, modern algorithm (PBKDF2-SHA256)
 * with proper salting and iteration count. Documents the migration path from
 * legacy SHA-256 and bcrypt formats to PBKDF2.
 *
 * SSOT: supabase/functions/_shared/crypto.ts
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("SEC-01: PIN Hashing Assessment", () => {
  // ---------------------------------------------------------------------------
  // Centralized crypto module existence
  // ---------------------------------------------------------------------------
  describe("Centralized crypto module", () => {
    it("should have _shared/crypto.ts as the SSOT for PIN hashing", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      expect(source).toBeTruthy();
      expect(source.length).toBeGreaterThan(0);
    });

    it("should export hashPinPbkdf2 as the recommended hash function", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const exports = findInSource(source, /export\s+async\s+function\s+hashPinPbkdf2/);
      expect(exports.length).toBe(1);
    });

    it("should export verifyPin as the unified verification function", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const exports = findInSource(
        source,
        /export\s+async\s+function\s+verifyPin\b(?!Pbkdf2|Bcrypt)/
      );
      expect(exports.length).toBe(1);
    });

    it("should export pinHashNeedsRehash for migration detection", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const exports = findInSource(source, /export\s+function\s+pinHashNeedsRehash/);
      expect(exports.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // PBKDF2 algorithm parameters
  // ---------------------------------------------------------------------------
  describe("PBKDF2 algorithm parameters", () => {
    it("should use at least 100,000 iterations (NIST SP 800-63B)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const iterMatch = findInSource(source, /PBKDF2_ITERATIONS\s*=\s*(\d[\d_]*)/);
      expect(iterMatch.length).toBeGreaterThan(0);
      const iterations = parseInt(iterMatch[0][1].replace(/_/g, ""), 10);
      expect(iterations).toBeGreaterThanOrEqual(100_000);
    });

    it("should use a random salt of at least 16 bytes", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const saltMatch = findInSource(source, /PBKDF2_SALT_BYTES\s*=\s*(\d+)/);
      expect(saltMatch.length).toBeGreaterThan(0);
      const saltBytes = parseInt(saltMatch[0][1], 10);
      expect(saltBytes).toBeGreaterThanOrEqual(16);
    });

    it("should produce a hash of at least 256 bits (32 bytes)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const hashMatch = findInSource(source, /PBKDF2_HASH_BYTES\s*=\s*(\d+)/);
      expect(hashMatch.length).toBeGreaterThan(0);
      const hashBytes = parseInt(hashMatch[0][1], 10);
      expect(hashBytes).toBeGreaterThanOrEqual(32);
    });

    it("should use SHA-256 as the underlying hash for PBKDF2", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const shaRefs = findInSource(source, /hash:\s*["']SHA-256["']/);
      expect(shaRefs.length).toBeGreaterThan(0);
    });

    it("should use crypto.getRandomValues for salt generation (CSPRNG)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const csprng = findInSource(source, /crypto\.getRandomValues/);
      expect(csprng.length).toBeGreaterThan(0);
    });

    it("should store hashes in format 'pbkdf2:<iterations>:<salt_hex>:<hash_hex>'", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const formatMatch = findInSource(source, /`pbkdf2:\$\{.*\}:\$\{.*\}:\$\{.*\}`/);
      expect(formatMatch.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Constant-time comparison in verification
  // ---------------------------------------------------------------------------
  describe("Constant-time comparison", () => {
    it("should use XOR-based constant-time comparison in verifyPinPbkdf2", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      // Look for the XOR comparison pattern within verifyPinPbkdf2
      const xorComparison = findInSource(
        source,
        /result\s*\|=\s*\w+\.charCodeAt\(\w+\)\s*\^\s*\w+\.charCodeAt\(\w+\)/
      );
      expect(xorComparison.length).toBeGreaterThan(0);
    });

    it("should NOT use simple === for hash comparison in verifyPinPbkdf2", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      // Extract the verifyPinPbkdf2 function body
      const fnStart = source.indexOf("export async function verifyPinPbkdf2");
      const fnEnd = source.indexOf("\n}", fnStart) + 2;
      const fnBody = source.substring(fnStart, fnEnd);
      // There should be NO direct === comparison of the hash values (actualHash === expectedHash)
      const directCompare = findInSource(fnBody, /actualHash\s*===\s*expectedHash/);
      expect(directCompare.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Legacy format support for migration
  // ---------------------------------------------------------------------------
  describe("Legacy hash migration path", () => {
    it("should mark legacy hashPin (SHA-256) as @deprecated", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      // Find the deprecated annotation near the hashPin function
      const deprecatedMatch = findInSource(
        source,
        /@deprecated.*hashPinPbkdf2|@deprecated.*Use hashPinPbkdf2/
      );
      expect(deprecatedMatch.length).toBeGreaterThan(0);
    });

    it("should support verifying legacy SHA-256 hashes (64-char hex)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const verifyPinFn = source.substring(
        source.indexOf("export async function verifyPin("),
        source.indexOf("\n}", source.indexOf("export async function verifyPin(")) + 2
      );
      // Should detect 64-char hex (legacy SHA-256) format
      const legacySha = findInSource(verifyPinFn, /sha256Hash|hashPin\(pin\)|Format 3.*Legacy/i);
      expect(legacySha.length).toBeGreaterThan(0);
    });

    it("should support verifying bcrypt hashes ($2a$ or $2b$ prefix)", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const verifyPinFn = source.substring(
        source.indexOf("export async function verifyPin("),
        source.indexOf("\n}", source.indexOf("export async function verifyPin(")) + 2
      );
      const bcryptSupport = findInSource(verifyPinFn, /\$2[ab]\$/);
      expect(bcryptSupport.length).toBeGreaterThan(0);
    });

    it("should detect non-PBKDF2 hashes as needing rehash", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const needsRehash = findInSource(
        source,
        /pinHashNeedsRehash[\s\S]*?startsWith\(["']pbkdf2:["']\)/
      );
      expect(needsRehash.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Transparent re-hash on successful verify (migration mechanism)
  // ---------------------------------------------------------------------------
  describe("Transparent re-hash on login", () => {
    it("should re-hash legacy PINs to PBKDF2 after successful verification in userHandlers", async () => {
      const source = await readSourceFile(
        "supabase/functions/badge-events/_shared/userHandlers.ts"
      );
      // Should call pinHashNeedsRehash and then hashPinPbkdf2 + update DB
      const rehashCheck = findInSource(source, /pinHashNeedsRehash/);
      expect(rehashCheck.length).toBeGreaterThan(0);

      const rehashAction = findInSource(source, /hashPinPbkdf2\(pin\)/);
      expect(rehashAction.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // badge-pin edge function uses PBKDF2
  // ---------------------------------------------------------------------------
  describe("badge-pin endpoint uses PBKDF2", () => {
    it("should import hashPinPbkdf2 from _shared/crypto.ts", async () => {
      const source = await readSourceFile("supabase/functions/badge-pin/index.ts");
      const importMatch = findInSource(
        source,
        /import\s*\{[^}]*hashPinPbkdf2[^}]*\}\s*from\s*["']\.\.\/_shared\/crypto/
      );
      expect(importMatch.length).toBeGreaterThan(0);
    });

    it("should call hashPinPbkdf2 (not legacy hashPin) when setting a new PIN", async () => {
      const source = await readSourceFile("supabase/functions/badge-pin/index.ts");
      const pbkdf2Call = findInSource(source, /hashPinPbkdf2\(pin\)/);
      expect(pbkdf2Call.length).toBeGreaterThan(0);

      // Should NOT use legacy hashPin for new PINs
      const legacyCall = findInSource(source, /(?<!Pbkdf2)\bhashPin\(pin\)/);
      expect(legacyCall.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // helpers.ts delegates to _shared/crypto.ts (no duplication)
  // ---------------------------------------------------------------------------
  describe("badge-events helpers.ts delegates to _shared/crypto.ts", () => {
    it("should import all crypto functions from _shared/crypto.ts", async () => {
      const source = await readSourceFile("supabase/functions/badge-events/_shared/helpers.ts");
      const importMatch = findInSource(
        source,
        /import\s*\{[^}]*\}\s*from\s*["']\.\.\/\.\.\/_shared\/crypto\.ts["']/
      );
      expect(importMatch.length).toBeGreaterThan(0);
    });

    it("should re-export hashPin as deprecated with delegation to _shared", async () => {
      const source = await readSourceFile("supabase/functions/badge-events/_shared/helpers.ts");
      const delegation = findInSource(source, /export\s+const\s+hashPin\s*=\s*_sharedHashPin/);
      expect(delegation.length).toBeGreaterThan(0);
      const deprecated = findInSource(source, /@deprecated.*hashPinPbkdf2/);
      expect(deprecated.length).toBeGreaterThan(0);
    });

    it("should NOT contain independent hashPin implementation (avoid duplication)", async () => {
      const source = await readSourceFile("supabase/functions/badge-events/_shared/helpers.ts");
      // Should NOT have its own `async function hashPin` — only a re-export const
      const ownImpl = findInSource(source, /export\s+async\s+function\s+hashPin/);
      expect(ownImpl.length).toBe(0);
    });
  });
});
