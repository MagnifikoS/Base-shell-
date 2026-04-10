/**
 * STK-01 -- Stock Event Append-Only Invariant Analysis
 *
 * Target:
 *   supabase/migrations/20260212155624_*.sql (initial stock_events table + triggers)
 *   supabase/migrations/20260216161233_*.sql (data repair that disabled triggers)
 *
 * Vulnerability Analysis:
 *   The stock_events table is declared as "append-only" via two BEFORE triggers:
 *   - trg_stock_events_no_update (prevents UPDATE)
 *   - trg_stock_events_no_delete (prevents DELETE)
 *
 *   However, these triggers can be bypassed by:
 *   1. Any user with TRIGGER privilege can ALTER TABLE ... DISABLE TRIGGER
 *   2. SECURITY DEFINER functions run as the function owner (typically superuser)
 *      and may bypass triggers if they operate with elevated privileges
 *   3. The migration 20260216161233 proves this bypass by disabling the trigger
 *      for a data repair, demonstrating the pattern exists in the codebase
 *
 *   At the RLS level, there are NO UPDATE or DELETE policies on stock_events,
 *   which is good. But the append-only guarantee relies on triggers, not
 *   CHECK constraints or database rules that cannot be disabled.
 *
 * PoC:
 *   1. Confirm triggers exist (not constraints)
 *   2. Confirm no RLS UPDATE/DELETE policies exist (defense in depth)
 *   3. Confirm the data repair migration disabled triggers (precedent)
 *   4. Confirm no CHECK constraint prevents mutation
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("STK-01: Stock Event Append-Only Not Enforced at DB Level", () => {
  const INITIAL_MIGRATION =
    "supabase/migrations/20260212155624_51d66c13-012d-4924-8982-82c1917327e4.sql";
  const REPAIR_MIGRATION =
    "supabase/migrations/20260216161233_c61cfc29-b922-4942-9ea8-319be532da39.sql";

  it("should confirm stock_events append-only is enforced via triggers (not constraints)", async () => {
    const source = await readSourceFile(INITIAL_MIGRATION);

    // Verify the immutable function exists
    const immutableFn = findInSource(source, /fn_stock_events_immutable/g);
    expect(immutableFn.length).toBeGreaterThan(0);

    // Verify it's a TRIGGER function, not a CHECK constraint
    const triggerUpdate = findInSource(source, /CREATE TRIGGER trg_stock_events_no_update/g);
    const triggerDelete = findInSource(source, /CREATE TRIGGER trg_stock_events_no_delete/g);
    expect(triggerUpdate.length).toBe(1);
    expect(triggerDelete.length).toBe(1);

    // Verify NO CHECK constraint exists for immutability
    // CHECK constraints cannot be disabled without ALTER TABLE DROP CONSTRAINT
    const checkConstraints = findInSource(
      source,
      /ADD CONSTRAINT.*stock_events.*immut|CHECK.*stock_events.*immut/gi
    );
    expect(checkConstraints.length).toBe(0);
  });

  it("should confirm triggers use BEFORE (not AFTER) which is bypassable by session-level disable", async () => {
    const source = await readSourceFile(INITIAL_MIGRATION);

    // BEFORE triggers can be disabled per-session with ALTER TABLE DISABLE TRIGGER
    const beforeUpdate = findInSource(source, /BEFORE UPDATE ON public\.stock_events/g);
    const beforeDelete = findInSource(source, /BEFORE DELETE ON public\.stock_events/g);

    expect(beforeUpdate.length).toBe(1);
    expect(beforeDelete.length).toBe(1);
  });

  it("should confirm data repair migration disabled the update trigger (proves bypass is possible)", async () => {
    const source = await readSourceFile(REPAIR_MIGRATION);

    // The migration explicitly disabled the trigger to UPDATE stock_events
    const disableTrigger = findInSource(source, /DISABLE TRIGGER trg_stock_events_no_update/g);
    expect(disableTrigger.length).toBe(1);

    // Then re-enabled it after the repair
    const enableTrigger = findInSource(source, /ENABLE TRIGGER trg_stock_events_no_update/g);
    expect(enableTrigger.length).toBe(1);

    // The migration performed UPDATEs on stock_events
    const updates = findInSource(source, /UPDATE public\.stock_events/g);
    expect(updates.length).toBeGreaterThan(0);
  });

  it("should confirm no RLS UPDATE policy exists on stock_events (partial defense)", async () => {
    const source = await readSourceFile(INITIAL_MIGRATION);

    // Verify only SELECT and INSERT policies exist (no UPDATE or DELETE)
    const selectPolicy = findInSource(source, /ON public\.stock_events FOR SELECT/g);
    const insertPolicy = findInSource(source, /ON public\.stock_events FOR INSERT/g);
    const updatePolicy = findInSource(source, /ON public\.stock_events FOR UPDATE/g);
    const deletePolicy = findInSource(source, /ON public\.stock_events FOR DELETE/g);

    expect(selectPolicy.length).toBe(1);
    expect(insertPolicy.length).toBe(1);
    // No UPDATE or DELETE policies = partial defense via RLS, but not a hard constraint
    expect(updatePolicy.length).toBe(0);
    expect(deletePolicy.length).toBe(0);
  });

  it("should confirm no FOR ALL policy was added on stock_events in later migrations", async () => {
    const migrationFiles = await globSourceFiles("supabase/migrations/*.sql");
    let forAllPolicyFound = false;

    for (const file of migrationFiles) {
      const source = await readSourceFile(file);
      const forAllPolicies = findInSource(source, /ON public\.stock_events FOR ALL/gi);
      if (forAllPolicies.length > 0) {
        forAllPolicyFound = true;
        break;
      }
    }

    // Good: no FOR ALL policy was added (which would grant UPDATE/DELETE via RLS)
    expect(forAllPolicyFound).toBe(false);
  });

  it("should confirm the trigger function uses RAISE EXCEPTION (not RETURN NULL) to block", async () => {
    const source = await readSourceFile(INITIAL_MIGRATION);

    // RAISE EXCEPTION is the right approach (aborts transaction)
    // RETURN NULL would only silently skip the row in some trigger contexts
    const raiseException = findInSource(
      source,
      /fn_stock_events_immutable[\s\S]*?RAISE EXCEPTION 'stock_events is append-only/g
    );
    expect(raiseException.length).toBe(1);
  });

  it("should confirm the delete trigger was NOT disabled during data repair (only update was)", async () => {
    const source = await readSourceFile(REPAIR_MIGRATION);

    // Only the update trigger was disabled, not the delete trigger
    const disableDelete = findInSource(source, /DISABLE TRIGGER trg_stock_events_no_delete/g);
    expect(disableDelete.length).toBe(0);

    // This means DELETE was still protected during repair, but UPDATE was not
    // The vulnerability is that the same pattern can be used to bypass DELETE too
    const disableUpdate = findInSource(source, /DISABLE TRIGGER trg_stock_events_no_update/g);
    expect(disableUpdate.length).toBe(1);
  });

  it("should document: SECURITY DEFINER functions bypass RLS but not triggers (limited risk)", async () => {
    const migrationFiles = await globSourceFiles("supabase/migrations/*.sql");

    // Find all SECURITY DEFINER functions that touch stock_events
    let securityDefinerCount = 0;
    for (const file of migrationFiles) {
      const source = await readSourceFile(file);
      // Functions that are SECURITY DEFINER and INSERT into stock_events
      const definerInserts = findInSource(
        source,
        /SECURITY DEFINER[\s\S]*?INSERT INTO stock_events/g
      );
      if (definerInserts.length > 0) {
        securityDefinerCount++;
      }
    }

    // SECURITY DEFINER functions that insert events exist (fn_post_stock_document, fn_void_stock_document)
    // They bypass RLS but triggers still fire. The risk is that a SECURITY DEFINER
    // function could also ALTER TABLE DISABLE TRIGGER if it's owned by a superuser.
    expect(securityDefinerCount).toBeGreaterThan(0);
  });
});
