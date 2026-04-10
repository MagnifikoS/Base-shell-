/**
 * JWT-01: Auth Middleware Assessment
 *
 * Verifies that standardized auth middleware exists and is used across
 * all edge functions. Checks for:
 *   - A shared requireAuth module at _shared/requireAuth.ts
 *   - supabase/config.toml has verify_jwt=false on all functions (auth done in code)
 *   - All non-public functions either use requireAuth or call getUser()
 *   - Documents any functions missing auth
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

// Functions that are intentionally public or use alternative auth
const KNOWN_PUBLIC_FUNCTIONS = [
  "health-check", // Public health endpoint — no auth needed
];

// Functions that use alternative auth mechanisms (not standard JWT)
const ALTERNATIVE_AUTH_FUNCTIONS = [
  "bootstrap-admin", // Uses x-bootstrap-secret header (not JWT)
  "accept-invitation", // Uses invitation token (may also have JWT)
];

describe("JWT-01: Auth Middleware Assessment", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. Shared requireAuth module exists
  // ═══════════════════════════════════════════════════════════════════════

  it("should have a shared requireAuth module at _shared/requireAuth.ts", async () => {
    const content = await readSourceFile("supabase/functions/_shared/requireAuth.ts");
    expect(content).toBeTruthy();
    expect(content.length).toBeGreaterThan(0);
  });

  it("requireAuth module should export requireAuth function", async () => {
    const content = await readSourceFile("supabase/functions/_shared/requireAuth.ts");
    expect(content).toContain("export async function requireAuth");
  });

  it("requireAuth module should export AuthError class", async () => {
    const content = await readSourceFile("supabase/functions/_shared/requireAuth.ts");
    expect(content).toContain("export class AuthError");
  });

  it("requireAuth should check for Authorization header", async () => {
    const content = await readSourceFile("supabase/functions/_shared/requireAuth.ts");
    expect(content).toContain("Authorization");
    expect(content).toContain("Missing authorization");
  });

  it("requireAuth should call getUser() to validate JWT", async () => {
    const content = await readSourceFile("supabase/functions/_shared/requireAuth.ts");
    expect(content).toContain("auth.getUser()");
  });

  it("requireAuth should throw on missing auth header (401)", async () => {
    const content = await readSourceFile("supabase/functions/_shared/requireAuth.ts");
    expect(content).toContain("401");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. config.toml: Count functions with verify_jwt = false
  // ═══════════════════════════════════════════════════════════════════════

  it("config.toml should exist and define edge function settings", async () => {
    const content = await readSourceFile("supabase/config.toml");
    expect(content).toBeTruthy();
    expect(content).toContain("[functions.");
  });

  it("all functions in config.toml should have verify_jwt = false (auth done in code)", async () => {
    const content = await readSourceFile("supabase/config.toml");
    const functionBlocks = findInSource(
      content,
      /\[functions\.([^\]]+)\]\s*\nverify_jwt\s*=\s*(true|false)/g
    );

    const withVerifyJwtTrue = functionBlocks.filter((m) => m[2] === "true");
    const withVerifyJwtFalse = functionBlocks.filter((m) => m[2] === "false");

    // Per CLAUDE.md: config.toml has verify_jwt = false for all functions
    // Auth is done in code via getUser()
    expect(withVerifyJwtTrue).toHaveLength(0);
    expect(withVerifyJwtFalse.length).toBeGreaterThan(0);

    console.log(`[JWT-01] Functions with verify_jwt=false: ${withVerifyJwtFalse.length}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. All non-public functions must have auth checks
  // ═══════════════════════════════════════════════════════════════════════

  it("all non-public edge functions should have auth checks (requireAuth or getUser)", async () => {
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");
    const missingAuth: string[] = [];
    const authReport: {
      function: string;
      method: string;
      isPublic: boolean;
    }[] = [];

    for (const file of edgeFunctions) {
      const content = await readSourceFile(file);
      const functionName = file.replace(/.*supabase\/functions\//, "").replace(/\/index\.ts$/, "");

      const isKnownPublic = KNOWN_PUBLIC_FUNCTIONS.includes(functionName);
      const isAlternativeAuth = ALTERNATIVE_AUTH_FUNCTIONS.includes(functionName);

      // Check for various auth patterns
      const usesRequireAuth = content.includes("requireAuth");
      const usesGetUser = content.includes("getUser");
      const checksAuthHeader =
        content.includes("Authorization") &&
        (content.includes("authHeader") || content.includes("auth_header"));
      const hasPublicComment = content.includes("// PUBLIC") || content.includes("/* PUBLIC */");

      let method = "NONE";
      if (usesRequireAuth) method = "requireAuth";
      else if (usesGetUser) method = "getUser";
      else if (checksAuthHeader) method = "manual auth header check";
      else if (isAlternativeAuth) method = "alternative auth (secret/token)";
      else if (isKnownPublic || hasPublicComment) method = "public (no auth)";

      authReport.push({
        function: functionName,
        method,
        isPublic: isKnownPublic || hasPublicComment,
      });

      // If not public and not alternative auth and no auth found
      if (
        !isKnownPublic &&
        !isAlternativeAuth &&
        !usesRequireAuth &&
        !usesGetUser &&
        !checksAuthHeader &&
        !hasPublicComment
      ) {
        missingAuth.push(functionName);
      }
    }

    // Log the full report
    console.log("[JWT-01] Auth report:");
    for (const entry of authReport) {
      console.log(`  ${entry.function}: ${entry.method}${entry.isPublic ? " (public)" : ""}`);
    }

    if (missingAuth.length > 0) {
      console.warn(`[JWT-01] FINDING: Functions missing auth: ${missingAuth.join(", ")}`);
    }

    // All non-public functions must have auth
    expect(missingAuth).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Verify auth checks happen BEFORE business logic
  // ═══════════════════════════════════════════════════════════════════════

  it("badge-events should check auth before processing business logic", async () => {
    const content = await readSourceFile("supabase/functions/badge-events/index.ts");
    const authIndex = content.indexOf("Authorization");
    const businessLogicIndex = content.indexOf("badge_events");

    // Auth check should appear before any DB table reference
    if (authIndex >= 0 && businessLogicIndex >= 0) {
      expect(authIndex).toBeLessThan(businessLogicIndex);
    }
  });

  it("employees should check auth before processing business logic", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    const authIndex = content.indexOf("Authorization");
    const businessLogicIndex = content.indexOf("switch (action)");

    // Auth check should appear before the action switch
    if (authIndex >= 0 && businessLogicIndex >= 0) {
      expect(authIndex).toBeLessThan(businessLogicIndex);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Verify requireAuth uses proper JWT validation (not just header check)
  // ═══════════════════════════════════════════════════════════════════════

  it("requireAuth should validate JWT via Supabase (not just check header presence)", async () => {
    const content = await readSourceFile("supabase/functions/_shared/requireAuth.ts");
    // Should create a Supabase client with the JWT
    expect(content).toContain("createClient");
    // Should call getUser() for server-side JWT validation
    expect(content).toContain("auth.getUser()");
    // Should handle errors from getUser
    expect(content).toContain("error");
    expect(content).toContain("Unauthorized");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Verify health-check is genuinely public (no sensitive data)
  // ═══════════════════════════════════════════════════════════════════════

  it("health-check (public function) should not expose sensitive data", async () => {
    const content = await readSourceFile("supabase/functions/health-check/index.ts");
    // Should not reference any sensitive tables
    expect(content).not.toContain("employee_details");
    expect(content).not.toContain("profiles");
    expect(content).not.toContain("user_roles");
    expect(content).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    // Should be a simple health check response
    expect(content).toContain("status");
    expect(content).toContain("ok");
  });
});
