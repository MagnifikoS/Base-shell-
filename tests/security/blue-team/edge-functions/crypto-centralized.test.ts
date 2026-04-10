/**
 * CRYPTO-01+02: Crypto Centralization Assessment
 *
 * Verifies that all cryptographic functions are defined in a SINGLE location
 * (supabase/functions/_shared/crypto.ts) and that other modules delegate to it
 * rather than implementing their own versions.
 *
 * Functions audited:
 * - hashPinPbkdf2 (PIN hashing — PBKDF2-SHA256)
 * - hashPin (legacy SHA-256 — deprecated)
 * - verifyPin (unified multi-format verifier)
 * - hashToken (invitation token hashing — SHA-256)
 * - timingSafeEqual (constant-time comparison)
 *
 * SSOT: supabase/functions/_shared/crypto.ts
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("CRYPTO-01+02: Crypto Centralization Assessment", () => {
  // ---------------------------------------------------------------------------
  // _shared/crypto.ts is the canonical source
  // ---------------------------------------------------------------------------
  describe("_shared/crypto.ts is the SSOT", () => {
    it("should exist and contain all crypto function definitions", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      expect(source).toBeTruthy();

      // All canonical exports must be present
      const expectedExports = [
        "hashPinPbkdf2",
        "verifyPinPbkdf2",
        "hashPin",
        "hashPinBcrypt",
        "verifyPinBcrypt",
        "verifyPin",
        "pinHashNeedsRehash",
        "hashToken",
        "timingSafeEqual",
      ];

      for (const fn of expectedExports) {
        const exportMatch = findInSource(
          source,
          new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`)
        );
        expect(exportMatch.length, `Expected export of '${fn}' in _shared/crypto.ts`).toBe(1);
      }
    });

    it("should have a clear SSOT comment header", async () => {
      const source = await readSourceFile("supabase/functions/_shared/crypto.ts");
      const ssotComment = findInSource(source, /SSOT|single source of truth|Shared cryptographic/i);
      expect(ssotComment.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // hashPinPbkdf2 is defined ONLY in _shared/crypto.ts
  // ---------------------------------------------------------------------------
  describe("hashPinPbkdf2 — single definition", () => {
    it("should have exactly ONE 'async function hashPinPbkdf2' definition across the codebase", async () => {
      const allFiles = await globSourceFiles("supabase/functions/**/*.ts");
      let definitionCount = 0;
      const definitionLocations: string[] = [];

      for (const file of allFiles) {
        const source = await readSourceFile(file);
        const defs = findInSource(source, /export\s+async\s+function\s+hashPinPbkdf2\b/);
        if (defs.length > 0) {
          definitionCount += defs.length;
          definitionLocations.push(file);
        }
      }

      expect(definitionCount, `hashPinPbkdf2 defined in: ${definitionLocations.join(", ")}`).toBe(
        1
      );
      expect(definitionLocations[0]).toContain("_shared/crypto.ts");
    });

    it("other files should use re-exports or imports, not independent implementations", async () => {
      const helpersSource = await readSourceFile(
        "supabase/functions/badge-events/_shared/helpers.ts"
      );
      // helpers.ts should delegate via re-export
      const delegation = findInSource(
        helpersSource,
        /export\s+const\s+hashPinPbkdf2\s*=\s*_sharedHashPinPbkdf2/
      );
      expect(delegation.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // hashPin (legacy) is defined ONLY in _shared/crypto.ts
  // ---------------------------------------------------------------------------
  describe("hashPin (legacy) — single definition", () => {
    it("should have exactly ONE 'async function hashPin' definition across the codebase", async () => {
      const allFiles = await globSourceFiles("supabase/functions/**/*.ts");
      let definitionCount = 0;
      const definitionLocations: string[] = [];

      for (const file of allFiles) {
        const source = await readSourceFile(file);
        const defs = findInSource(source, /export\s+async\s+function\s+hashPin\b/);
        if (defs.length > 0) {
          definitionCount += defs.length;
          definitionLocations.push(file);
        }
      }

      expect(definitionCount, `hashPin defined in: ${definitionLocations.join(", ")}`).toBe(1);
      expect(definitionLocations[0]).toContain("_shared/crypto.ts");
    });
  });

  // ---------------------------------------------------------------------------
  // hashToken is defined ONLY in _shared/crypto.ts
  // ---------------------------------------------------------------------------
  describe("hashToken — single definition", () => {
    it("should have exactly ONE 'async function hashToken' definition across the codebase", async () => {
      const allFiles = await globSourceFiles("supabase/functions/**/*.ts");
      let definitionCount = 0;
      const definitionLocations: string[] = [];

      for (const file of allFiles) {
        const source = await readSourceFile(file);
        const defs = findInSource(source, /export\s+async\s+function\s+hashToken\b/);
        if (defs.length > 0) {
          definitionCount += defs.length;
          definitionLocations.push(file);
        }
      }

      expect(definitionCount, `hashToken defined in: ${definitionLocations.join(", ")}`).toBe(1);
      expect(definitionLocations[0]).toContain("_shared/crypto.ts");
    });

    it("consumers should import hashToken from _shared/crypto.ts", async () => {
      const consumers = [
        "supabase/functions/accept-invitation/index.ts",
        "supabase/functions/admin-invitations/index.ts",
        "supabase/functions/admin-create-test-user/index.ts",
      ];

      for (const file of consumers) {
        let source: string;
        try {
          source = await readSourceFile(file);
        } catch {
          // File may not exist — skip
          continue;
        }
        const importMatch = findInSource(
          source,
          /import\s*\{[^}]*hashToken[^}]*\}\s*from\s*["']\.\.\/_shared\/crypto/
        );
        expect(
          importMatch.length,
          `${file} should import hashToken from _shared/crypto.ts`
        ).toBeGreaterThan(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // timingSafeEqual is defined ONLY in _shared/crypto.ts
  // ---------------------------------------------------------------------------
  describe("timingSafeEqual — single definition", () => {
    it("should have exactly ONE 'async function timingSafeEqual' definition", async () => {
      const allFiles = await globSourceFiles("supabase/functions/**/*.ts");
      let definitionCount = 0;
      const definitionLocations: string[] = [];

      for (const file of allFiles) {
        const source = await readSourceFile(file);
        const defs = findInSource(source, /export\s+async\s+function\s+timingSafeEqual\b/);
        if (defs.length > 0) {
          definitionCount += defs.length;
          definitionLocations.push(file);
        }
      }

      expect(definitionCount, `timingSafeEqual defined in: ${definitionLocations.join(", ")}`).toBe(
        1
      );
      expect(definitionLocations[0]).toContain("_shared/crypto.ts");
    });

    it("bootstrap-admin should import timingSafeEqual from _shared/crypto.ts", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      const importMatch = findInSource(
        source,
        /import\s*\{[^}]*timingSafeEqual[^}]*\}\s*from\s*["']\.\.\/_shared\/crypto/
      );
      expect(importMatch.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // No raw crypto.subtle.digest calls outside _shared/crypto.ts
  // ---------------------------------------------------------------------------
  describe("No ad-hoc crypto usage outside _shared/crypto.ts", () => {
    it("edge function index files should NOT call crypto.subtle.digest directly", async () => {
      const indexFiles = await globSourceFiles("supabase/functions/*/index.ts");

      for (const file of indexFiles) {
        const source = await readSourceFile(file);
        const rawDigest = findInSource(source, /crypto\.subtle\.digest/);
        expect(
          rawDigest.length,
          `${file} should not call crypto.subtle.digest directly — use _shared/crypto.ts`
        ).toBe(0);
      }
    });

    it("edge function index files should NOT call crypto.subtle.importKey for hashing directly", async () => {
      const indexFiles = await globSourceFiles("supabase/functions/*/index.ts");

      // employees/index.ts uses crypto.subtle.importKey for AES-GCM data encryption
      // (IBAN/SSN), which is a separate concern from PIN/token hashing and is acceptable.
      const excludedFiles = ["employees"];

      for (const file of indexFiles) {
        const isExcluded = excludedFiles.some((name) => file.includes(`/${name}/`));
        if (isExcluded) continue;

        const source = await readSourceFile(file);
        const rawImportKey = findInSource(source, /crypto\.subtle\.importKey/);
        expect(
          rawImportKey.length,
          `${file} should not call crypto.subtle.importKey directly — use _shared/crypto.ts`
        ).toBe(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // badge-events helpers.ts is purely a delegation layer
  // ---------------------------------------------------------------------------
  describe("badge-events helpers.ts delegation pattern", () => {
    it("should import all 4 crypto functions from _shared/crypto.ts", async () => {
      const source = await readSourceFile("supabase/functions/badge-events/_shared/helpers.ts");
      const importMatch = findInSource(
        source,
        /import\s*\{[^}]*\}\s*from\s*["']\.\.\/\.\.\/_shared\/crypto\.ts["']/
      );
      expect(importMatch.length).toBe(1);

      // Verify the import includes all 4 functions
      const importLine = importMatch[0][0];
      expect(importLine).toContain("hashPin");
      expect(importLine).toContain("verifyPin");
      expect(importLine).toContain("hashPinPbkdf2");
      expect(importLine).toContain("pinHashNeedsRehash");
    });

    it("should re-export via const assignment (not re-implement)", async () => {
      const source = await readSourceFile("supabase/functions/badge-events/_shared/helpers.ts");
      // All 4 should be simple const re-exports
      const reExports = [
        /export\s+const\s+hashPin\s*=\s*_sharedHashPin/,
        /export\s+const\s+verifyPin\s*=\s*_sharedVerifyPin/,
        /export\s+const\s+hashPinPbkdf2\s*=\s*_sharedHashPinPbkdf2/,
        /export\s+const\s+pinHashNeedsRehash\s*=\s*_sharedPinHashNeedsRehash/,
      ];

      for (const pattern of reExports) {
        const match = findInSource(source, pattern);
        expect(match.length, `Expected delegation pattern: ${pattern.source}`).toBe(1);
      }
    });
  });
});
