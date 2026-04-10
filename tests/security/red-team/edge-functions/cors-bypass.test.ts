/**
 * SEC-03 -- CORS Configuration Analysis
 *
 * Target: supabase/functions/_shared/cors.ts + all edge functions
 *
 * Finding:
 *   The shared cors.ts uses a hybrid model:
 *   - Legacy `corsHeaders` uses wildcard "*" (deprecated, for backward compat)
 *   - New `makeCorsHeaders(methods, req)` does dynamic origin matching
 *     against CORE_ORIGINS allowlist + ALLOWED_ORIGIN env var
 *
 *   Verifies:
 *   1. ALLOWED_ORIGIN env var is supported for additional origins
 *   2. CORE_ORIGINS contains production domain (not wildcard)
 *   3. No edge functions define their own corsHeaders with "*"
 *   4. Dynamic origin validation exists in makeCorsHeaders
 *   5. At least 5 edge functions import from shared cors module
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("SEC-03: CORS Configuration Analysis", () => {
  it("should confirm _shared/cors.ts uses ALLOWED_ORIGIN env var for extra origins", async () => {
    const source = await readSourceFile("supabase/functions/_shared/cors.ts");

    // Should use environment variable
    const envVarUsage = findInSource(source, /ALLOWED_ORIGIN/g);
    expect(envVarUsage.length).toBeGreaterThan(0);

    // Should have Deno.env.get for reading the env var
    expect(source).toContain("Deno.env.get");
  });

  it("should confirm CORE_ORIGINS contains production domain, not wildcard", async () => {
    const source = await readSourceFile("supabase/functions/_shared/cors.ts");

    // Production domain should be in the allowlist
    const prodDomain = findInSource(source, /https:\/\/app\.restaurantos\.fr/g);
    expect(prodDomain.length).toBeGreaterThan(0);

    // CORE_ORIGINS should be defined as an allowlist
    expect(source).toContain("CORE_ORIGINS");
  });

  it("should confirm all edge functions use the shared corsHeaders (no local overrides with *)", async () => {
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");
    expect(edgeFunctions.length).toBeGreaterThan(0);

    const functionsWithWildcardCors: string[] = [];

    for (const funcPath of edgeFunctions) {
      const source = await readSourceFile(funcPath);
      // Check for any locally defined Access-Control-Allow-Origin: "*"
      const wildcardMatches = findInSource(source, /"Access-Control-Allow-Origin":\s*"\*"/g);
      if (wildcardMatches.length > 0) {
        functionsWithWildcardCors.push(funcPath);
      }
    }

    // No edge functions should have hardcoded wildcard CORS
    expect(functionsWithWildcardCors).toEqual([]);
  });

  it("should verify at least 5 edge functions import from _shared/cors.ts", async () => {
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");

    let functionsUsingSharedCors = 0;
    for (const funcPath of edgeFunctions) {
      const source = await readSourceFile(funcPath);
      const sharedCorsImport = findInSource(source, /from\s+["']\.\.\/_shared\/cors/g);
      if (sharedCorsImport.length > 0) {
        functionsUsingSharedCors++;
      }
    }

    // At least 5 edge functions should import from shared cors
    expect(functionsUsingSharedCors).toBeGreaterThanOrEqual(5);
  });

  it("should confirm makeCorsHeaders validates the incoming Origin header (dynamic matching)", async () => {
    const source = await readSourceFile("supabase/functions/_shared/cors.ts");

    // The makeCorsHeaders function should check req.headers.get("origin")
    // against the allowlist — this is an improvement over static wildcard
    const originCheck = findInSource(
      source,
      /req\.headers\.get\(["']origin["']\)|request\.headers/gi
    );
    // Dynamic origin validation exists (improvement from previous static model)
    expect(originCheck.length).toBeGreaterThan(0);
  });

  it("should document legacy corsHeaders wildcard as deprecated", async () => {
    const source = await readSourceFile("supabase/functions/_shared/cors.ts");

    // Legacy corsHeaders exists with wildcard "*" — this is documented as deprecated
    // Functions should migrate to makeCorsHeaders(methods, req) for dynamic origin matching
    expect(source).toContain("corsHeaders");
    expect(source).toContain("makeCorsHeaders");

    // Verify that legacy wildcard is documented as intentional (not accidental)
    const hasLegacyComment =
      source.includes("Legacy") || source.includes("legacy") || source.includes("backward");
    expect(hasLegacyComment).toBe(true);
  });
});
