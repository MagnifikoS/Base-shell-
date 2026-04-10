/**
 * SEC-02 -- PIN Attempt Limiting Analysis
 *
 * Target: supabase/functions/badge-events/_shared/userHandlers.ts
 *         supabase/functions/badge-events/index.ts
 *
 * Analysis:
 *   The badge-events userHandlers.ts NOW has PIN attempt tracking via the
 *   badge_pin_failures table with a 5-attempt limit per 15-minute window.
 *   This test verifies the remediation is in place, but also identifies
 *   remaining gaps:
 *
 *   1. Rate limit is per user+establishment, not globally per IP
 *   2. Attacker can try 5 PINs per 15 minutes = 20 per hour = 480 per day
 *   3. With 10,000 possible PINs, brute force completes in ~21 days
 *   4. No account lockout (only temporary delay)
 *   5. Failed attempts are cleared on successful PIN (resets the window)
 *   6. The badge-pin endpoint (separate from badge-events) has IP-based
 *      rate limiting but the PIN CHECK in badge-events only uses DB-based
 *      counting which is bypassable with distributed IPs
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("SEC-02: PIN Attempt Rate Limiting Analysis", () => {
  it("should confirm badge_pin_failures table is used for tracking", async () => {
    const source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
    const pinFailures = findInSource(source, /badge_pin_failures/g);
    // This should now exist (remediation was applied)
    expect(pinFailures.length).toBeGreaterThan(0);
  });

  it("should confirm the rate limit window is only 15 minutes (not permanent lockout)", async () => {
    const source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
    // PIN_RATE_LIMIT_WINDOW_MIN = 15
    const windowMatch = findInSource(source, /PIN_RATE_LIMIT_WINDOW_MIN\s*=\s*15/g);
    expect(windowMatch.length).toBe(1);
  });

  it("should confirm the max attempts is only 5 per window", async () => {
    const source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
    // PIN_RATE_LIMIT_MAX = 5
    const maxMatch = findInSource(source, /PIN_RATE_LIMIT_MAX\s*=\s*5/g);
    expect(maxMatch.length).toBe(1);
  });

  it("should confirm failed attempts are cleared on successful PIN (window reset)", async () => {
    const source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
    // On successful PIN, failed attempts are deleted
    // SEC-02: On successful PIN, clear failed attempts
    const clearOnSuccess = findInSource(source, /\.from\("badge_pin_failures"\)\s*\.delete\(\)/g);
    expect(clearOnSuccess.length).toBeGreaterThan(0);
  });

  it("should confirm rate limit is per user+establishment (not per IP, so distributed attack works)", async () => {
    const source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
    // The query filters by user_id and establishment_id, not by IP
    const userFilter = findInSource(
      source,
      /\.eq\("user_id",\s*userId\)[\s\S]*?\.eq\("establishment_id",\s*establishment_id\)/g
    );
    expect(userFilter.length).toBeGreaterThan(0);

    // No IP-based filtering in the PIN check logic
    const ipFilter = findInSource(source, /x-forwarded-for|x-real-ip|client_ip/gi);
    // IP filtering should NOT be present in the PIN check (it is only in the outer rate limiter)
    expect(ipFilter.length).toBe(0);
  });

  it("should confirm no permanent account lockout mechanism exists", async () => {
    const source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
    // No account_locked, is_locked, locked_until, or permanent lockout
    const lockoutPatterns = findInSource(
      source,
      /account_locked|is_locked|locked_until|permanent.*lock/gi
    );
    expect(lockoutPatterns.length).toBe(0);
  });

  it("should calculate that brute force is feasible within 21 days at 5 per 15 min", () => {
    const PIN_SPACE = 10000;
    const ATTEMPTS_PER_WINDOW = 5;
    const WINDOW_MINUTES = 15;
    const ATTEMPTS_PER_HOUR = (60 / WINDOW_MINUTES) * ATTEMPTS_PER_WINDOW;
    const ATTEMPTS_PER_DAY = ATTEMPTS_PER_HOUR * 24;
    const DAYS_TO_EXHAUST = Math.ceil(PIN_SPACE / ATTEMPTS_PER_DAY);

    expect(ATTEMPTS_PER_HOUR).toBe(20);
    expect(ATTEMPTS_PER_DAY).toBe(480);
    // Full brute force in ~21 days (worst case)
    expect(DAYS_TO_EXHAUST).toBe(21);
    // Average case = ~10.5 days (half the keyspace)
    expect(Math.ceil(DAYS_TO_EXHAUST / 2)).toBeLessThanOrEqual(11);
  });

  it("should confirm badge-events index.ts has HTTP-level rate limiting (60/min)", async () => {
    const source = await readSourceFile("supabase/functions/badge-events/index.ts");
    // checkRateLimit with 60 requests per minute
    const rateLimitCall = findInSource(source, /checkRateLimit(?:Sync)?\(req/g);
    expect(rateLimitCall.length).toBe(1);

    // But this is 60 per minute per IP -- generous enough for brute force
    const maxRequests = findInSource(source, /max:\s*60/g);
    expect(maxRequests.length).toBe(1);
  });
});
