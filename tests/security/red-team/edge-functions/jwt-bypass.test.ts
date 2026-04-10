/**
 * JWT-01 -- All Edge Functions Skip JWT Verification
 *
 * Target: supabase/config.toml
 *
 * Vulnerability:
 *   ALL edge functions in config.toml have `verify_jwt = false`.
 *   This means Supabase API gateway does NOT verify JWTs before
 *   forwarding requests to edge functions. Authentication relies
 *   entirely on manual getUser() calls within each function.
 *
 *   Impact:
 *   - If any function forgets to call getUser(), it is completely open
 *   - The anon key (public) is sufficient to call any function
 *   - No JWT signature validation at the gateway level
 *   - Auth bypass if a function has a code path that skips getUser()
 *
 *   This is a defense-in-depth violation: the gateway should serve as
 *   a first line of defense, with in-code auth as the second layer.
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("JWT-01: All Functions Skip JWT Verification", () => {
  it("should read supabase/config.toml successfully", async () => {
    const source = await readSourceFile("supabase/config.toml");
    expect(source.length).toBeGreaterThan(0);
  });

  it("should confirm ALL function entries have verify_jwt = false", async () => {
    const source = await readSourceFile("supabase/config.toml");

    // Find all verify_jwt entries
    const verifyJwtEntries = findInSource(source, /verify_jwt\s*=\s*(true|false)/g);
    expect(verifyJwtEntries.length).toBeGreaterThan(0);

    // Count true vs false
    const verifyTrue = findInSource(source, /verify_jwt\s*=\s*true/g);
    const verifyFalse = findInSource(source, /verify_jwt\s*=\s*false/g);

    // ZERO functions have verify_jwt = true
    expect(verifyTrue.length).toBe(0);

    // ALL functions have verify_jwt = false
    expect(verifyFalse.length).toBe(verifyJwtEntries.length);
    expect(verifyFalse.length).toBeGreaterThan(0);
  });

  it("should count the exact number of functions with verify_jwt = false", async () => {
    const source = await readSourceFile("supabase/config.toml");

    // Find all [functions.xxx] sections
    const functionSections = findInSource(source, /\[functions\.[a-z0-9_-]+\]/g);
    const verifyFalse = findInSource(source, /verify_jwt\s*=\s*false/g);

    // Every function section should have verify_jwt = false
    expect(functionSections.length).toBe(verifyFalse.length);

    // There should be a significant number of functions (20+)
    expect(functionSections.length).toBeGreaterThanOrEqual(20);
  });

  it("should list all function names with verify_jwt = false", async () => {
    const source = await readSourceFile("supabase/config.toml");

    // Extract function names from [functions.xxx] sections
    const functionNames: string[] = [];
    const matches = findInSource(source, /\[functions\.([a-z0-9_-]+)\]/g);
    for (const match of matches) {
      functionNames.push(match[1]);
    }

    // All of these have verify_jwt = false
    expect(functionNames.length).toBeGreaterThanOrEqual(20);

    // Confirm some critical functions are in the list
    const criticalFunctions = [
      "bootstrap-admin",
      "accept-invitation",
      "admin-reset-password",
      "planning-week",
      "employees",
      "badge-events",
    ];

    // Note: badge-events and employees may not be in config.toml if they were
    // added without config entries (defaults to verify_jwt=true in that case)
    // But based on the config we read, we can check what IS there
    for (const name of criticalFunctions) {
      if (functionNames.includes(name)) {
        // Confirm it has verify_jwt = false by checking the source
        const pattern = new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt\\s*=\\s*false`, "g");
        const match = findInSource(source, pattern);
        expect(match.length).toBe(1);
      }
    }
  });

  it("should confirm config.toml has NO verify_jwt = true entries", async () => {
    const source = await readSourceFile("supabase/config.toml");

    const verifyTrue = findInSource(source, /verify_jwt\s*=\s*true/g);
    expect(verifyTrue.length).toBe(0);
  });
});
