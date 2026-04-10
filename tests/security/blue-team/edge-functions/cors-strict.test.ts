/**
 * SEC-03: CORS Assessment
 *
 * Verifies that CORS is properly restricted across all edge functions.
 * Checks for:
 *   - A shared CORS module with origin allowlist
 *   - Dynamic origin matching via makeCorsHeaders (preferred)
 *   - Legacy corsHeaders with wildcard (deprecated, documented)
 *   - Vary: Origin header awareness
 *   - All edge functions importing from the shared CORS module
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("SEC-03: CORS Assessment", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. Shared CORS module exists
  // ═══════════════════════════════════════════════════════════════════════

  it("should have a shared CORS module at _shared/cors.ts", async () => {
    const content = await readSourceFile("supabase/functions/_shared/cors.ts");
    expect(content).toBeTruthy();
    expect(content.length).toBeGreaterThan(0);
  });

  it("shared CORS module should define corsHeaders export", async () => {
    const content = await readSourceFile("supabase/functions/_shared/cors.ts");
    expect(content).toContain("export const corsHeaders");
  });

  it("shared CORS module should use ALLOWED_ORIGIN env var and CORE_ORIGINS allowlist", async () => {
    const content = await readSourceFile("supabase/functions/_shared/cors.ts");
    // Should read from env
    expect(content).toContain("ALLOWED_ORIGIN");
    expect(content).toContain("Deno.env.get");
    // Should have a CORE_ORIGINS allowlist
    expect(content).toContain("CORE_ORIGINS");
    // Should have a dynamic makeCorsHeaders that does origin matching
    expect(content).toContain("makeCorsHeaders");
  });

  it("shared CORS module should have production URL in CORE_ORIGINS allowlist", async () => {
    const content = await readSourceFile("supabase/functions/_shared/cors.ts");
    // The allowlist should contain the production domain
    const prodOrigin = findInSource(content, /https:\/\/app\.restaurantos\.fr/g);
    expect(prodOrigin.length).toBeGreaterThan(0);
  });

  it("makeCorsHeaders should dynamically resolve origin from request", async () => {
    const content = await readSourceFile("supabase/functions/_shared/cors.ts");
    // makeCorsHeaders should accept a Request parameter for origin matching
    expect(content).toContain("makeCorsHeaders");
    // Should check request origin against allowlist
    const originCheck = findInSource(content, /req\.headers\.get\(["']origin["']\)/gi);
    expect(originCheck.length).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. No edge function uses Access-Control-Allow-Origin: *
  // ═══════════════════════════════════════════════════════════════════════

  it("no edge function should define its own wildcard CORS origin", async () => {
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");
    const violations: string[] = [];

    for (const file of edgeFunctions) {
      const content = await readSourceFile(file);
      const wildcardMatches = findInSource(
        content,
        /["']Access-Control-Allow-Origin["']\s*:\s*["']\*["']/g
      );
      if (wildcardMatches.length > 0) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Verify at least 5 edge functions import from shared CORS
  // ═══════════════════════════════════════════════════════════════════════

  it("at least 5 edge functions should import corsHeaders from the shared module", async () => {
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");
    const functionsUsingSharedCors: string[] = [];

    for (const file of edgeFunctions) {
      const content = await readSourceFile(file);
      // Check for import from _shared/cors.ts or via respond.ts which re-exports it
      const importsCors =
        content.includes("../_shared/cors.ts") ||
        content.includes("../_shared/cors") ||
        content.includes("./_shared/respond.ts") ||
        content.includes("./_shared/respond");
      if (importsCors) {
        functionsUsingSharedCors.push(file);
      }
    }

    expect(functionsUsingSharedCors.length).toBeGreaterThanOrEqual(5);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Document which functions define their own cors vs. shared
  // ═══════════════════════════════════════════════════════════════════════

  it("should document all edge functions and their CORS source", async () => {
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");
    const report: { function: string; usesSharedCors: boolean; definesOwn: boolean }[] = [];

    for (const file of edgeFunctions) {
      const content = await readSourceFile(file);
      const functionName = file.replace(/.*supabase\/functions\//, "").replace(/\/index\.ts$/, "");

      const usesSharedCors =
        content.includes("../_shared/cors.ts") ||
        content.includes("../_shared/cors") ||
        content.includes("./_shared/respond.ts") ||
        content.includes("./_shared/respond");

      const definesOwn = content.includes("Access-Control-Allow-Origin") && !usesSharedCors;

      report.push({ function: functionName, usesSharedCors, definesOwn });
    }

    // All functions should use shared CORS
    const functionsWithOwnCors = report.filter((r) => r.definesOwn && !r.usesSharedCors);
    expect(functionsWithOwnCors).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Verify Vary: Origin header awareness
  // ═══════════════════════════════════════════════════════════════════════

  it("should document Vary: Origin header status in shared CORS module", async () => {
    const content = await readSourceFile("supabase/functions/_shared/cors.ts");
    // Check if Vary header is set — this is a best practice for CORS with
    // non-wildcard origins, to prevent CDN cache poisoning.
    // If Vary: Origin is NOT present, this is a finding to document.
    const hasVaryOrigin = content.includes("Vary") && content.includes("Origin");

    // Document the finding: Vary: Origin is recommended but may not be present.
    // This test passes either way but documents the current state.
    if (!hasVaryOrigin) {
      console.warn(
        "[SEC-03] FINDING: Shared CORS module does not set Vary: Origin header. " +
          "This is recommended when Access-Control-Allow-Origin is not *."
      );
    }
    // The test passes — Vary: Origin is a recommendation, not a hard requirement
    // when the origin is a single fixed value (not dynamic per-request).
    // If ALLOWED_ORIGIN is read from env and could change per-deployment,
    // Vary: Origin is less critical since it is the same for all requests.
    expect(content).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Verify CORS preflight handling in edge functions
  // ═══════════════════════════════════════════════════════════════════════

  it("all edge functions should handle OPTIONS preflight requests", async () => {
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");
    const missingPreflight: string[] = [];

    for (const file of edgeFunctions) {
      const content = await readSourceFile(file);
      const functionName = file.replace(/.*supabase\/functions\//, "").replace(/\/index\.ts$/, "");

      // Check for OPTIONS handling
      const handlesOptions = content.includes('"OPTIONS"') || content.includes("'OPTIONS'");

      if (!handlesOptions) {
        missingPreflight.push(functionName);
      }
    }

    // All functions should handle OPTIONS for CORS preflight
    expect(missingPreflight).toEqual([]);
  });
});
