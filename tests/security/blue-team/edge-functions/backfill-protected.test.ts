/**
 * BACKFILL-01: Backfill Protection Assessment
 *
 * Verifies that all backfill edge functions are properly protected.
 * Backfill functions are one-shot scripts that modify large amounts of data,
 * so they must have strong authentication and admin-only access.
 *
 * Checks for:
 *   - Each backfill function has auth (requireAuth or getUser)
 *   - Each backfill function verifies admin role
 *   - No backfill function uses service role key without auth
 */

import { describe, it, expect } from "vitest";
import { readSourceFile } from "../../helpers";

const BACKFILL_FUNCTIONS = [
  {
    name: "backfill-invoice-snapshots",
    path: "supabase/functions/backfill-invoice-snapshots/index.ts",
    description: "Backfills invoice line items with snapshots and global product IDs",
  },
  {
    name: "backfill-product-codes",
    path: "supabase/functions/backfill-product-codes/index.ts",
    description: "Extracts product codes from invoice extractions",
  },
  {
    name: "backfill-products-ssot",
    path: "supabase/functions/backfill-products-ssot/index.ts",
    description: "Creates global products from validated supplier products",
  },
];

describe("BACKFILL-01: Backfill Protection Assessment", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. All backfill functions exist
  // ═══════════════════════════════════════════════════════════════════════

  for (const fn of BACKFILL_FUNCTIONS) {
    it(`backfill function '${fn.name}' should exist`, async () => {
      const content = await readSourceFile(fn.path);
      expect(content).toBeTruthy();
      expect(content.length).toBeGreaterThan(0);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. All backfill functions have authentication
  // ═══════════════════════════════════════════════════════════════════════

  for (const fn of BACKFILL_FUNCTIONS) {
    it(`backfill function '${fn.name}' should require authentication`, async () => {
      const content = await readSourceFile(fn.path);

      const hasRequireAuth = content.includes("requireAuth");
      const hasGetUser = content.includes("getUser");
      const hasAuthCheck = hasRequireAuth || hasGetUser;

      expect(hasAuthCheck).toBe(true);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. All backfill functions verify admin role
  // ═══════════════════════════════════════════════════════════════════════

  for (const fn of BACKFILL_FUNCTIONS) {
    it(`backfill function '${fn.name}' should verify admin role`, async () => {
      const content = await readSourceFile(fn.path);

      const checksAdmin =
        content.includes("is_admin") ||
        content.includes("isAdmin") ||
        content.includes("admin_exists") ||
        content.includes("has_role") ||
        content.includes("has_module_access");

      expect(checksAdmin).toBe(true);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. All backfill functions return 403 on non-admin access
  // ═══════════════════════════════════════════════════════════════════════

  for (const fn of BACKFILL_FUNCTIONS) {
    it(`backfill function '${fn.name}' should return 403 for non-admin users`, async () => {
      const content = await readSourceFile(fn.path);
      expect(content).toContain("403");
      // Should have an explicit access denied message
      const hasForbiddenMessage =
        content.includes("Forbidden") ||
        content.includes("Admin access required") ||
        content.includes("Access denied");
      expect(hasForbiddenMessage).toBe(true);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Service role key usage comes AFTER auth
  // ═══════════════════════════════════════════════════════════════════════

  for (const fn of BACKFILL_FUNCTIONS) {
    it(`backfill function '${fn.name}' should use service role key ONLY after auth check`, async () => {
      const content = await readSourceFile(fn.path);

      // requireAuth or getUser should appear BEFORE SERVICE_ROLE_KEY usage
      const authIndex = Math.min(
        content.includes("requireAuth") ? content.indexOf("requireAuth") : Infinity,
        content.includes("getUser") ? content.indexOf("getUser") : Infinity
      );
      const serviceKeyIndex = content.indexOf("SUPABASE_SERVICE_ROLE_KEY");

      if (serviceKeyIndex >= 0) {
        expect(authIndex).toBeLessThan(serviceKeyIndex);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Backfill functions use requireAuth (shared module) specifically
  // ═══════════════════════════════════════════════════════════════════════

  it("all backfill functions should use the shared requireAuth module", async () => {
    const functionsUsingRequireAuth: string[] = [];
    const functionsNotUsingRequireAuth: string[] = [];

    for (const fn of BACKFILL_FUNCTIONS) {
      const content = await readSourceFile(fn.path);

      if (content.includes("requireAuth")) {
        functionsUsingRequireAuth.push(fn.name);
      } else {
        functionsNotUsingRequireAuth.push(fn.name);
      }
    }

    // All backfill functions should use the standardized requireAuth
    expect(functionsUsingRequireAuth.length).toBe(BACKFILL_FUNCTIONS.length);
    expect(functionsNotUsingRequireAuth).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Backfill functions handle CORS preflight
  // ═══════════════════════════════════════════════════════════════════════

  for (const fn of BACKFILL_FUNCTIONS) {
    it(`backfill function '${fn.name}' should handle OPTIONS preflight`, async () => {
      const content = await readSourceFile(fn.path);
      expect(content).toContain('"OPTIONS"');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Backfill functions handle AuthError from requireAuth
  // ═══════════════════════════════════════════════════════════════════════

  for (const fn of BACKFILL_FUNCTIONS) {
    it(`backfill function '${fn.name}' should handle AuthError thrown by requireAuth`, async () => {
      const content = await readSourceFile(fn.path);

      // Should catch AuthError and return proper HTTP status
      const handlesAuthError =
        content.includes("AuthError") || (content.includes("catch") && content.includes("401"));

      expect(handlesAuthError).toBe(true);
    });
  }
});
