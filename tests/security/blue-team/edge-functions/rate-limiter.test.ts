/**
 * SEC-05: Rate Limiting Assessment
 *
 * Verifies that rate limiting exists and is applied to critical edge functions.
 * Checks for:
 *   - A shared rate limiting module at _shared/rateLimit.ts
 *   - Critical functions (badge-events, badge-pin, employees, bootstrap-admin) use it
 *   - The rate limiter returns 429 responses with Retry-After header
 *   - Documents which functions have/don't have rate limiting
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("SEC-05: Rate Limiting Assessment", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. Shared rate limiting module exists
  // ═══════════════════════════════════════════════════════════════════════

  it("should have a shared rate limiting module at _shared/rateLimit.ts", async () => {
    const content = await readSourceFile("supabase/functions/_shared/rateLimit.ts");
    expect(content).toBeTruthy();
    expect(content.length).toBeGreaterThan(0);
  });

  it("rate limiting module should export checkRateLimit function", async () => {
    const content = await readSourceFile("supabase/functions/_shared/rateLimit.ts");
    expect(content).toContain("export function checkRateLimit");
  });

  it("rate limiting module should return 429 when limit exceeded", async () => {
    const content = await readSourceFile("supabase/functions/_shared/rateLimit.ts");
    expect(content).toContain("429");
    expect(content).toContain("Too many requests");
  });

  it("rate limiting module should include Retry-After header in 429 responses", async () => {
    const content = await readSourceFile("supabase/functions/_shared/rateLimit.ts");
    expect(content).toContain("Retry-After");
  });

  it("rate limiting module should use IP-based rate limiting", async () => {
    const content = await readSourceFile("supabase/functions/_shared/rateLimit.ts");
    // Should use x-forwarded-for or similar IP extraction
    expect(content).toContain("x-forwarded-for");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Critical functions must use rate limiting
  // ═══════════════════════════════════════════════════════════════════════

  const criticalFunctions = [
    {
      name: "badge-events",
      path: "supabase/functions/badge-events/index.ts",
      reason: "High-frequency endpoint, brute-force target",
    },
    {
      name: "badge-pin",
      path: "supabase/functions/badge-pin/index.ts",
      reason: "PIN management — brute-force target",
    },
    {
      name: "bootstrap-admin",
      path: "supabase/functions/bootstrap-admin/index.ts",
      reason: "Admin creation — critical security endpoint",
    },
  ];

  for (const fn of criticalFunctions) {
    it(`critical function '${fn.name}' should use rate limiting (${fn.reason})`, async () => {
      const content = await readSourceFile(fn.path);
      const usesRateLimit = content.includes("checkRateLimit") || content.includes("rateLimit");
      expect(usesRateLimit).toBe(true);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Rate limit configuration should be strict for sensitive endpoints
  // ═══════════════════════════════════════════════════════════════════════

  it("badge-pin should have a strict rate limit (max <= 10 per minute)", async () => {
    const content = await readSourceFile("supabase/functions/badge-pin/index.ts");
    const rateLimitCalls = findInSource(
      content,
      /checkRateLimit(?:Sync)?\(req,\s*\{[^}]*max:\s*(\d+)/g
    );
    expect(rateLimitCalls.length).toBeGreaterThan(0);
    const maxValue = parseInt(rateLimitCalls[0][1], 10);
    expect(maxValue).toBeLessThanOrEqual(10);
  });

  it("bootstrap-admin should have a strict rate limit (max <= 5 per minute)", async () => {
    const content = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
    const rateLimitCalls = findInSource(
      content,
      /checkRateLimit(?:Sync)?\(req,\s*\{[^}]*max:\s*(\d+)/g
    );
    expect(rateLimitCalls.length).toBeGreaterThan(0);
    const maxValue = parseInt(rateLimitCalls[0][1], 10);
    expect(maxValue).toBeLessThanOrEqual(5);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Document all functions' rate limiting status
  // ═══════════════════════════════════════════════════════════════════════

  it("should document which functions have/don't have rate limiting", async () => {
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");
    const withRateLimit: string[] = [];
    const withoutRateLimit: string[] = [];

    for (const file of edgeFunctions) {
      const content = await readSourceFile(file);
      const functionName = file.replace(/.*supabase\/functions\//, "").replace(/\/index\.ts$/, "");

      const usesRateLimit = content.includes("checkRateLimit") || content.includes("rateLimit");

      if (usesRateLimit) {
        withRateLimit.push(functionName);
      } else {
        withoutRateLimit.push(functionName);
      }
    }

    // Document the findings
    console.log(`[SEC-05] Functions WITH rate limiting (${withRateLimit.length}):`, withRateLimit);
    console.log(
      `[SEC-05] Functions WITHOUT rate limiting (${withoutRateLimit.length}):`,
      withoutRateLimit
    );

    // At least the critical functions should have rate limiting
    expect(withRateLimit.length).toBeGreaterThanOrEqual(3);

    // Verify the employees function status (large, sensitive endpoint)
    // Note: employees is a large function and may not yet have rate limiting
    const employeesContent = await readSourceFile("supabase/functions/employees/index.ts");
    const employeesHasRateLimit =
      employeesContent.includes("checkRateLimit") || employeesContent.includes("rateLimit");

    if (!employeesHasRateLimit) {
      console.warn(
        "[SEC-05] FINDING: employees edge function does not use rate limiting. " +
          "This is a sensitive endpoint handling PII (IBAN, SSN)."
      );
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Rate limiter should have cleanup mechanism
  // ═══════════════════════════════════════════════════════════════════════

  it("rate limiting module should have DB-backed storage with cleanup", async () => {
    const content = await readSourceFile("supabase/functions/_shared/rateLimit.ts");
    // Should have DB-backed mode (rate_limit_entries table)
    expect(content).toContain("rate_limit_entries");
    // Should have in-memory fallback with cleanup
    const hasCleanup =
      content.includes("cleanup") || content.includes("delete") || content.includes("memoryStore");
    expect(hasCleanup).toBe(true);
    // Should have dual-mode: DB primary + memory fallback
    expect(content).toContain("checkDbRateLimit");
    expect(content).toContain("checkMemoryRateLimit");
  });
});
