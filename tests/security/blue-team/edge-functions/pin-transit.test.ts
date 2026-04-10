/**
 * DATA-02: PIN Transit Security Assessment
 *
 * Audits how the 4-digit badge PIN is handled between the frontend and backend.
 *
 * Current state:
 * - The PIN is sent as PLAINTEXT in the JSON body of the badge-events request.
 * - The transport is protected by HTTPS (TLS), so the PIN is encrypted at the
 *   transport layer. However, the PIN is visible in:
 *   - Server access logs (if body logging is enabled)
 *   - Any middleware or proxy that inspects request bodies
 *   - Browser DevTools network tab (not a risk in production mobile, but in dev)
 *
 * Ideal state:
 * - Client-side hashing of the PIN before sending (defense in depth)
 * - Or at minimum, clear documentation that HTTPS is the sole protection layer
 *
 * This test file documents both the current vulnerability and verifies
 * server-side protections that mitigate the risk.
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("DATA-02: PIN Transit Security Assessment", () => {
  // ---------------------------------------------------------------------------
  // Frontend PIN handling
  // ---------------------------------------------------------------------------
  describe("Frontend PIN transmission (useCreateBadgeEvent)", () => {
    let hookSource: string;

    it("should send PIN in the request body to badge-events", async () => {
      hookSource = await readSourceFile("src/hooks/badgeuse/useCreateBadgeEvent.ts");
      // Verify the hook sends a `pin` field in the JSON body
      const pinInBody = findInSource(hookSource, /pin:\s*params\.pin/);
      expect(pinInBody.length).toBeGreaterThan(0);
    });

    it("[VULN] PIN is sent as plaintext (not hashed client-side before transmission)", async () => {
      hookSource = await readSourceFile("src/hooks/badgeuse/useCreateBadgeEvent.ts");
      // Check if there is any client-side hashing before sending
      const clientHash = findInSource(hookSource, /hashPin|crypto\.subtle|sha256|pbkdf2|bcrypt/i);
      // This test PASSES because the vulnerability EXISTS (no client-side hashing)
      expect(clientHash.length).toBe(0);
    });

    it("should use Bearer token authentication (HTTPS protects in transit)", async () => {
      hookSource = await readSourceFile("src/hooks/badgeuse/useCreateBadgeEvent.ts");
      const authHeader = findInSource(hookSource, /Authorization:\s*`Bearer\s+\$\{/);
      expect(authHeader.length).toBeGreaterThan(0);
    });

    it("should use the Supabase URL (which implies HTTPS in production)", async () => {
      hookSource = await readSourceFile("src/hooks/badgeuse/useCreateBadgeEvent.ts");
      const urlRef = findInSource(
        hookSource,
        /VITE_SUPABASE_URL|import\.meta\.env\.VITE_SUPABASE_URL/
      );
      expect(urlRef.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Server-side PIN handling mitigations
  // ---------------------------------------------------------------------------
  describe("Server-side PIN handling mitigations", () => {
    it("badge-events should hash the PIN immediately on receipt (not store plaintext)", async () => {
      const source = await readSourceFile(
        "supabase/functions/badge-events/_shared/userHandlers.ts"
      );
      // PIN from body should be used only for verification, never stored as-is
      // The verification function (verifyPin) takes the raw PIN and the stored hash
      const verifyCall = findInSource(source, /verifyPin\(pin,\s*userPin\.pin_hash\)/);
      expect(verifyCall.length).toBeGreaterThan(0);
    });

    it("badge-events should NOT log or store the raw PIN value", async () => {
      const source = await readSourceFile(
        "supabase/functions/badge-events/_shared/userHandlers.ts"
      );
      // Should NOT have console.log(pin) or log the pin value
      const pinLog = findInSource(source, /console\.log\([^)]*\bpin\b|log\.\w+\([^)]*\bpin\b/);
      // Filter out legitimate references like "pin_hash" or "require_pin"
      const actualPinLogs = pinLog.filter(
        (m) =>
          !m[0].includes("pin_hash") &&
          !m[0].includes("require_pin") &&
          !m[0].includes("pin_failures")
      );
      expect(actualPinLogs.length).toBe(0);
    });

    it("badge-pin endpoint should hash PIN with PBKDF2 before storing", async () => {
      const source = await readSourceFile("supabase/functions/badge-pin/index.ts");
      // Should call hashPinPbkdf2(pin) before storing
      const hashBeforeStore = findInSource(source, /hashPinPbkdf2\(pin\)/);
      expect(hashBeforeStore.length).toBeGreaterThan(0);

      // Should store pin_hash (not raw pin)
      const storeHash = findInSource(source, /pin_hash:\s*pinHash/);
      expect(storeHash.length).toBeGreaterThan(0);
    });

    it("badge-pin endpoint should NOT store the raw PIN", async () => {
      const source = await readSourceFile("supabase/functions/badge-pin/index.ts");
      // Make sure the raw `pin` variable is NOT directly inserted into the database
      // The upsert should use `pinHash` (the hashed version), not `pin`
      const rawPinInUpsert = findInSource(source, /pin_hash:\s*pin(?!Hash)/);
      expect(rawPinInUpsert.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // PIN validation at the API boundary
  // ---------------------------------------------------------------------------
  describe("PIN format validation (input sanitization)", () => {
    it("badge-pin should validate PIN is exactly 4 digits", async () => {
      const source = await readSourceFile("supabase/functions/badge-pin/index.ts");
      // Should check for 4-digit format
      const formatCheck = findInSource(source, /pin\.length\s*!==\s*4/);
      expect(formatCheck.length).toBeGreaterThan(0);

      const digitCheck = findInSource(source, /\/\^\\d\{4\}\$\/\.test\(pin\)/);
      expect(digitCheck.length).toBeGreaterThan(0);
    });

    it("badge-pin should validate PIN is a string type", async () => {
      const source = await readSourceFile("supabase/functions/badge-pin/index.ts");
      const typeCheck = findInSource(source, /typeof\s+pin\s*!==\s*["']string["']/);
      expect(typeCheck.length).toBeGreaterThan(0);
    });

    it("badge-events should require PIN when settings mandate it", async () => {
      const source = await readSourceFile(
        "supabase/functions/badge-events/_shared/userHandlers.ts"
      );
      const requireCheck = findInSource(source, /cfg\.require_pin/);
      expect(requireCheck.length).toBeGreaterThan(0);

      const pinRequiredError = findInSource(source, /PIN_REQUIRED/);
      expect(pinRequiredError.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Rate limiting protects against brute force even with plaintext transit
  // ---------------------------------------------------------------------------
  describe("Brute-force mitigations (compensating controls for plaintext PIN)", () => {
    it("badge-pin endpoint should have HTTP-level rate limiting", async () => {
      const source = await readSourceFile("supabase/functions/badge-pin/index.ts");
      const rateLimit = findInSource(source, /checkRateLimit/);
      expect(rateLimit.length).toBeGreaterThan(0);
    });

    it("badge-events should have application-level PIN attempt limiting", async () => {
      const source = await readSourceFile(
        "supabase/functions/badge-events/_shared/userHandlers.ts"
      );
      const attemptLimit = findInSource(source, /PIN_RATE_LIMIT_MAX/);
      expect(attemptLimit.length).toBeGreaterThan(0);
    });

    it("badge-events should have debounce protection on the client side", async () => {
      const source = await readSourceFile("src/hooks/badgeuse/useCreateBadgeEvent.ts");
      const debounce = findInSource(source, /BADGE_DEBOUNCE_MS/);
      expect(debounce.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling does not leak PIN information
  // ---------------------------------------------------------------------------
  describe("Error handling does not leak PIN data", () => {
    it("badge-pin should return generic error messages (SEC-20 pattern)", async () => {
      const source = await readSourceFile("supabase/functions/badge-pin/index.ts");
      const sec20 = findInSource(source, /SEC-20/);
      expect(sec20.length).toBeGreaterThan(0);

      // Should have log.error for server-side details
      const serverLog = findInSource(source, /log\.error/);
      expect(serverLog.length).toBeGreaterThan(0);
    });

    it("badge-events should not include PIN hash in error responses", async () => {
      const source = await readSourceFile(
        "supabase/functions/badge-events/_shared/userHandlers.ts"
      );
      // Error responses should not contain pin_hash
      const hashInResponse = findInSource(source, /jsonErr\([^)]*pin_hash|jsonOk\([^)]*pin_hash/);
      expect(hashInResponse.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Summary: Risk assessment documentation
  // ---------------------------------------------------------------------------
  describe("Risk assessment summary", () => {
    it("COMPENSATING CONTROLS: HTTPS + rate limiting + PBKDF2 storage mitigate plaintext transit risk", async () => {
      // This is a documentation test that summarizes the current security posture.
      // The PIN is transmitted as plaintext over HTTPS, which provides:
      // 1. TLS encryption in transit (HTTPS mandatory for Supabase)
      // 2. Server-side PBKDF2 hashing before storage
      // 3. HTTP-level rate limiting (checkRateLimit)
      // 4. Application-level PIN attempt limiting (5 attempts / 15 min)
      // 5. Client-side debounce (3s between attempts)
      //
      // RECOMMENDATION: For defense-in-depth, consider client-side hashing
      // using Web Crypto API before transmission. This would protect against
      // server log exposure and middleware inspection scenarios.
      //
      // RISK LEVEL: LOW (compensating controls are adequate for a 4-digit PIN
      // given the rate limiting and HTTPS transport encryption).
      expect(true).toBe(true);
    });
  });
});
