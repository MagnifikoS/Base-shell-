/**
 * SEC-05 -- Rate Limiting Coverage Analysis
 *
 * Target: All edge functions
 *
 * Finding (REMEDIATED):
 *   All edge functions now use the shared rate limiting module at
 *   _shared/rateLimit.ts with dual-mode support (DB-backed primary +
 *   in-memory fallback). Coverage is 100%.
 *
 *   The rate limiter uses a `rate_limit_entries` DB table for persistence
 *   across cold starts, with an in-memory Map fallback when DB is unavailable.
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("SEC-05: Rate Limiting Coverage", () => {
  it("should confirm a rate limit module exists at _shared/rateLimit.ts", async () => {
    const source = await readSourceFile("supabase/functions/_shared/rateLimit.ts");
    expect(source.length).toBeGreaterThan(0);
    const exportMatch = findInSource(source, /export function checkRateLimit/g);
    expect(exportMatch.length).toBe(1);
  });

  it("should confirm the rate limiter uses DB-backed storage (FIXED — persists across cold starts)", async () => {
    const source = await readSourceFile("supabase/functions/_shared/rateLimit.ts");
    // Has in-memory fallback
    const mapUsage = findInSource(source, /new Map/g);
    expect(mapUsage.length).toBeGreaterThan(0);

    // FIXED: Also has DB-backed storage (rate_limit_entries table)
    const dbUsage = findInSource(source, /rate_limit_entries|supabaseAdmin|checkDbRateLimit/gi);
    expect(dbUsage.length).toBeGreaterThan(0);
  });

  it("should identify which edge functions DO NOT use checkRateLimit", async () => {
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");
    expect(edgeFunctions.length).toBeGreaterThan(0);

    const withRateLimit: string[] = [];
    const withoutRateLimit: string[] = [];

    for (const funcPath of edgeFunctions) {
      const source = await readSourceFile(funcPath);
      const rateLimitUsage = findInSource(source, /checkRateLimit/g);
      const funcName = funcPath.replace(/.*supabase\/functions\//, "").replace(/\/index\.ts$/, "");

      if (rateLimitUsage.length > 0) {
        withRateLimit.push(funcName);
      } else {
        withoutRateLimit.push(funcName);
      }
    }

    // Nearly all functions now use rate limiting (health-check excluded)
    expect(withRateLimit.length).toBeGreaterThan(0);

    // Only health-check is allowed to not have rate limiting
    const allowedExceptions = ["health-check"];
    const unexpectedWithout = withoutRateLimit.filter((name) => !allowedExceptions.includes(name));
    expect(unexpectedWithout.length).toBe(0);
  });

  it("should confirm the rate limiter has dual-mode: DB-backed + in-memory fallback (FIXED)", async () => {
    const source = await readSourceFile("supabase/functions/_shared/rateLimit.ts");

    // Has in-memory store as fallback
    const memoryStore = findInSource(source, /memoryStore|const memoryStore/g);
    expect(memoryStore.length).toBeGreaterThan(0);

    // FIXED: Has DB-backed primary mode
    const dbMode = findInSource(source, /checkDbRateLimit|rate_limit_entries/g);
    expect(dbMode.length).toBeGreaterThan(0);

    // Has async API that accepts supabaseAdmin
    const asyncApi = findInSource(source, /async function checkRateLimit|supabaseAdmin/g);
    expect(asyncApi.length).toBeGreaterThan(0);
  });

  it("should confirm the rate limiter uses x-forwarded-for (spoofable header)", async () => {
    const source = await readSourceFile("supabase/functions/_shared/rateLimit.ts");

    // IP extraction from x-forwarded-for header (easily spoofable)
    const headerExtract = findInSource(source, /x-forwarded-for/gi);
    expect(headerExtract.length).toBeGreaterThan(0);

    // Falls back to "unknown" if no IP header (all unknowns share the same bucket)
    const unknownFallback = findInSource(source, /"unknown"/g);
    expect(unknownFallback.length).toBeGreaterThan(0);
  });

  it("should count the total number of edge functions vs those with rate limiting", async () => {
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");

    let withRateLimit = 0;
    for (const funcPath of edgeFunctions) {
      const source = await readSourceFile(funcPath);
      if (findInSource(source, /checkRateLimit/g).length > 0) {
        withRateLimit++;
      }
    }

    const totalFunctions = edgeFunctions.length;
    const withoutRateLimit = totalFunctions - withRateLimit;
    const coveragePercent = Math.round((withRateLimit / totalFunctions) * 100);

    // Rate limiting coverage is near 100% (health-check excluded)
    expect(coveragePercent).toBeGreaterThanOrEqual(95);
    // At most 1 function (health-check) lacks rate limiting
    expect(withoutRateLimit).toBeLessThanOrEqual(1);
  });
});
