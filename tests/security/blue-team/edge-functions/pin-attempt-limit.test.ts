/**
 * SEC-02: PIN Attempt Limit Assessment
 *
 * Verifies that PIN brute-force protection is in place:
 * - Failed attempts are tracked in a dedicated table (badge_pin_failures)
 * - Rate limiting enforces max 5 attempts per 15-minute window
 * - Successful PIN entry clears the failure counter
 * - The migration creates the table with proper indexes and RLS
 *
 * SSOT: supabase/functions/badge-events/_shared/userHandlers.ts
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("SEC-02: PIN Attempt Limit Assessment", () => {
  // ---------------------------------------------------------------------------
  // Database schema for attempt tracking
  // ---------------------------------------------------------------------------
  describe("badge_pin_failures table (schema)", () => {
    it("should have a migration creating the badge_pin_failures table", async () => {
      const migrationFiles = await globSourceFiles(
        "supabase/migrations/*create_badge_pin_failures*"
      );
      expect(migrationFiles.length).toBeGreaterThan(0);
    });

    it("should define badge_pin_failures with user_id, establishment_id, and attempted_at columns", async () => {
      const migrationFiles = await globSourceFiles(
        "supabase/migrations/*create_badge_pin_failures*"
      );
      expect(migrationFiles.length).toBeGreaterThan(0);

      const migration = await readSourceFile(migrationFiles[0]);
      expect(migration).toContain("user_id");
      expect(migration).toContain("establishment_id");
      expect(migration).toContain("attempted_at");
    });

    it("should have an index on (user_id, establishment_id, attempted_at) for efficient lookups", async () => {
      const migrationFiles = await globSourceFiles(
        "supabase/migrations/*create_badge_pin_failures*"
      );
      const migration = await readSourceFile(migrationFiles[0]);
      const indexMatch = findInSource(
        migration,
        /CREATE\s+INDEX.*badge_pin_failures.*user_id.*establishment_id.*attempted_at/is
      );
      expect(indexMatch.length).toBeGreaterThan(0);
    });

    it("should enable Row Level Security on badge_pin_failures", async () => {
      const migrationFiles = await globSourceFiles(
        "supabase/migrations/*create_badge_pin_failures*"
      );
      const migration = await readSourceFile(migrationFiles[0]);
      const rlsMatch = findInSource(migration, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
      expect(rlsMatch.length).toBeGreaterThan(0);
    });

    it("should reference auth.users with ON DELETE CASCADE", async () => {
      const migrationFiles = await globSourceFiles(
        "supabase/migrations/*create_badge_pin_failures*"
      );
      const migration = await readSourceFile(migrationFiles[0]);
      const cascadeMatch = findInSource(
        migration,
        /user_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+auth\.users.*ON\s+DELETE\s+CASCADE/i
      );
      expect(cascadeMatch.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Rate limiting logic in userHandlers
  // ---------------------------------------------------------------------------
  describe("Rate limiting logic in userHandlers", () => {
    let source: string;

    it("should define a max attempt limit constant", async () => {
      source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
      const limitMatch = findInSource(source, /PIN_RATE_LIMIT_MAX\s*=\s*(\d+)/);
      expect(limitMatch.length).toBeGreaterThan(0);
      const maxAttempts = parseInt(limitMatch[0][1], 10);
      expect(maxAttempts).toBeGreaterThanOrEqual(3);
      expect(maxAttempts).toBeLessThanOrEqual(10);
    });

    it("should define a time window constant (in minutes)", async () => {
      source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
      const windowMatch = findInSource(source, /PIN_RATE_LIMIT_WINDOW_MIN\s*=\s*(\d+)/);
      expect(windowMatch.length).toBeGreaterThan(0);
      const windowMin = parseInt(windowMatch[0][1], 10);
      expect(windowMin).toBeGreaterThanOrEqual(5);
      expect(windowMin).toBeLessThanOrEqual(30);
    });

    it("should query badge_pin_failures for recent failed attempts within the window", async () => {
      source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
      const queryMatch = findInSource(source, /\.from\(["']badge_pin_failures["']\)/);
      expect(queryMatch.length).toBeGreaterThan(0);

      // Should filter by time window
      const timeFilter = findInSource(source, /\.gte\(["']attempted_at["'],\s*rateLimitCutoff\)/);
      expect(timeFilter.length).toBeGreaterThan(0);
    });

    it("should block with 429 status when attempt limit is reached", async () => {
      source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
      const blockMatch = findInSource(source, /PIN_RATE_LIMITED/);
      expect(blockMatch.length).toBeGreaterThan(0);

      const status429 = findInSource(source, /429/);
      expect(status429.length).toBeGreaterThan(0);
    });

    it("should record failed PIN attempt in badge_pin_failures on invalid PIN", async () => {
      source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
      // After PIN verification fails, should insert into badge_pin_failures
      const insertMatch = findInSource(source, /\.from\(["']badge_pin_failures["']\)\s*\.insert/);
      expect(insertMatch.length).toBeGreaterThan(0);
    });

    it("should clear failed attempts on successful PIN entry", async () => {
      source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
      // After successful PIN verification, should delete from badge_pin_failures
      const deleteMatch = findInSource(source, /\.from\(["']badge_pin_failures["']\)\s*\.delete/);
      expect(deleteMatch.length).toBeGreaterThan(0);
    });

    it("should report remaining attempts to the user after a failed PIN", async () => {
      source = await readSourceFile("supabase/functions/badge-events/_shared/userHandlers.ts");
      const remainingMatch = findInSource(source, /remainingAttempts/);
      expect(remainingMatch.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // PIN check occurs before badge event creation
  // ---------------------------------------------------------------------------
  describe("PIN check ordering", () => {
    it("should check PIN BEFORE inserting badge_event (fail-fast pattern)", async () => {
      const source = await readSourceFile(
        "supabase/functions/badge-events/_shared/userHandlers.ts"
      );
      const pinCheckPos = source.indexOf("require_pin");
      const insertPos = source.indexOf('.from("badge_events")');
      expect(pinCheckPos).toBeGreaterThan(-1);
      expect(insertPos).toBeGreaterThan(-1);
      // PIN check must come BEFORE badge event insert
      expect(pinCheckPos).toBeLessThan(insertPos);
    });
  });

  // ---------------------------------------------------------------------------
  // Error codes are specific (not generic)
  // ---------------------------------------------------------------------------
  describe("Error code specificity", () => {
    it("should use distinct error codes: PIN_REQUIRED, PIN_NOT_SET, INVALID_PIN, PIN_RATE_LIMITED", async () => {
      const source = await readSourceFile(
        "supabase/functions/badge-events/_shared/userHandlers.ts"
      );
      expect(findInSource(source, /PIN_REQUIRED/).length).toBeGreaterThan(0);
      expect(findInSource(source, /PIN_NOT_SET/).length).toBeGreaterThan(0);
      expect(findInSource(source, /INVALID_PIN/).length).toBeGreaterThan(0);
      expect(findInSource(source, /PIN_RATE_LIMITED/).length).toBeGreaterThan(0);
    });
  });
});
