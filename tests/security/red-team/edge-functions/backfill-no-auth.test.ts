/**
 * BACKFILL-01 -- Backfill Functions Authentication Analysis
 *
 * Target: supabase/functions/backfill-invoice-snapshots/index.ts
 *         supabase/functions/backfill-product-codes/index.ts
 *         supabase/functions/backfill-products-ssot/index.ts
 *
 * Updated Finding:
 *   The backfill functions have been REMEDIATED -- they now use requireAuth()
 *   and check for admin role via is_admin() RPC. However, this test verifies
 *   the remediation is complete and identifies remaining concerns:
 *
 *   1. All 3 functions now call requireAuth() (good)
 *   2. All 3 functions check is_admin (good)
 *   3. They still use service role key for mutations (necessary but risky)
 *   4. They now have rate limiting (FIXED)
 *   5. They lack audit logging for the backfill action itself
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

const BACKFILL_FUNCTIONS = [
  "supabase/functions/backfill-invoice-snapshots/index.ts",
  "supabase/functions/backfill-product-codes/index.ts",
  "supabase/functions/backfill-products-ssot/index.ts",
];

describe("BACKFILL-01: Backfill Functions Authentication Analysis", () => {
  it("should confirm all 3 backfill functions now import requireAuth", async () => {
    for (const funcPath of BACKFILL_FUNCTIONS) {
      const source = await readSourceFile(funcPath);
      const requireAuthImport = findInSource(source, /import.*requireAuth/g);
      expect(requireAuthImport.length, `${funcPath} should import requireAuth`).toBeGreaterThan(0);
    }
  });

  it("should confirm all 3 backfill functions call requireAuth(req)", async () => {
    for (const funcPath of BACKFILL_FUNCTIONS) {
      const source = await readSourceFile(funcPath);
      const requireAuthCall = findInSource(source, /await requireAuth\(req\)/g);
      expect(requireAuthCall.length, `${funcPath} should call requireAuth(req)`).toBeGreaterThan(0);
    }
  });

  it("should confirm all 3 backfill functions check admin role", async () => {
    for (const funcPath of BACKFILL_FUNCTIONS) {
      const source = await readSourceFile(funcPath);
      const adminCheck = findInSource(source, /is_admin/g);
      expect(adminCheck.length, `${funcPath} should check admin role`).toBeGreaterThan(0);
    }
  });

  it("should confirm all 3 functions return 403 when not admin", async () => {
    for (const funcPath of BACKFILL_FUNCTIONS) {
      const source = await readSourceFile(funcPath);
      const forbiddenResponse = findInSource(source, /status:\s*403/g);
      expect(
        forbiddenResponse.length,
        `${funcPath} should return 403 for non-admin`
      ).toBeGreaterThan(0);
    }
  });

  it("should confirm all 3 functions still use SERVICE_ROLE_KEY for mutations", async () => {
    for (const funcPath of BACKFILL_FUNCTIONS) {
      const source = await readSourceFile(funcPath);
      const serviceRole = findInSource(source, /SUPABASE_SERVICE_ROLE_KEY/g);
      expect(serviceRole.length, `${funcPath} should use SERVICE_ROLE_KEY`).toBeGreaterThan(0);
    }
  });

  it("should confirm all backfill functions now have rate limiting (FIXED)", async () => {
    for (const funcPath of BACKFILL_FUNCTIONS) {
      const source = await readSourceFile(funcPath);
      const rateLimit = findInSource(source, /checkRateLimit/g);
      expect(rateLimit.length, `${funcPath} should have rate limiting`).toBeGreaterThan(0);
    }
  });

  it("should confirm AuthError is handled for all 3 functions", async () => {
    for (const funcPath of BACKFILL_FUNCTIONS) {
      const source = await readSourceFile(funcPath);
      const authErrorHandling = findInSource(source, /AuthError/g);
      expect(authErrorHandling.length, `${funcPath} should handle AuthError`).toBeGreaterThan(0);
    }
  });
});
