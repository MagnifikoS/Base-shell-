/**
 * STK-01: Stock Event Immutability Defense
 *
 * Verifies that stock_events is an append-only ledger:
 *   - Trigger prevents UPDATE on stock_events
 *   - Trigger prevents DELETE on stock_events
 *   - RLS policies do NOT grant UPDATE or DELETE
 *   - SECURITY DEFINER functions only temporarily disable triggers for data repair
 *
 * SSOT: supabase/migrations/20260212155624_*.sql (initial stock schema)
 *       supabase/migrations/20260216161233_*.sql (one-time data repair)
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

const STOCK_SCHEMA_MIGRATION =
  "supabase/migrations/20260212155624_51d66c13-012d-4924-8982-82c1917327e4.sql";

const DATA_REPAIR_MIGRATION =
  "supabase/migrations/20260216161233_c61cfc29-b922-4942-9ea8-319be532da39.sql";

describe("STK-01 Defense: Stock Event Immutability", () => {
  // ---------------------------------------------------------------------------
  // Immutability function exists
  // ---------------------------------------------------------------------------
  describe("Immutability trigger function", () => {
    it("should define fn_stock_events_immutable that raises exception on UPDATE/DELETE", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const fnDef = findInSource(
        source,
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_stock_events_immutable\(\)/i
      );
      expect(fnDef.length).toBeGreaterThanOrEqual(1);
    });

    it("should raise exception with clear message about append-only constraint", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const raiseMsg = findInSource(
        source,
        /RAISE\s+EXCEPTION\s+'stock_events is append-only:\s*UPDATE and DELETE are forbidden'/i
      );
      expect(raiseMsg.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Triggers attached to stock_events
  // ---------------------------------------------------------------------------
  describe("Immutability triggers on stock_events", () => {
    it("should have trg_stock_events_no_update trigger BEFORE UPDATE", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const trigger = findInSource(
        source,
        /CREATE\s+TRIGGER\s+trg_stock_events_no_update\s+BEFORE\s+UPDATE\s+ON\s+public\.stock_events/i
      );
      expect(trigger.length).toBe(1);
    });

    it("should have trg_stock_events_no_delete trigger BEFORE DELETE", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const trigger = findInSource(
        source,
        /CREATE\s+TRIGGER\s+trg_stock_events_no_delete\s+BEFORE\s+DELETE\s+ON\s+public\.stock_events/i
      );
      expect(trigger.length).toBe(1);
    });

    it("both triggers should execute fn_stock_events_immutable", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const executions = findInSource(
        source,
        /EXECUTE\s+FUNCTION\s+public\.fn_stock_events_immutable\(\)/i
      );
      // One for UPDATE trigger, one for DELETE trigger
      expect(executions.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // RLS policies do NOT grant UPDATE or DELETE on stock_events
  // ---------------------------------------------------------------------------
  describe("RLS policies restrict stock_events to SELECT and INSERT only", () => {
    it("should have a SELECT policy on stock_events", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      // Policy name is on a separate line from "ON public.stock_events FOR SELECT"
      const selectPolicy = findInSource(source, /ON\s+public\.stock_events\s+FOR\s+SELECT/i);
      expect(selectPolicy.length).toBeGreaterThanOrEqual(1);
    });

    it("should have an INSERT policy on stock_events", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const insertPolicy = findInSource(source, /ON\s+public\.stock_events\s+FOR\s+INSERT/i);
      expect(insertPolicy.length).toBeGreaterThanOrEqual(1);
    });

    it("should NOT have an UPDATE policy on stock_events", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const updatePolicy = findInSource(source, /ON\s+public\.stock_events\s+FOR\s+UPDATE/i);
      expect(updatePolicy.length).toBe(0);
    });

    it("should NOT have a DELETE policy on stock_events", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const deletePolicy = findInSource(source, /ON\s+public\.stock_events\s+FOR\s+DELETE/i);
      expect(deletePolicy.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Data repair migration re-enables triggers
  // ---------------------------------------------------------------------------
  describe("Data repair migration preserves immutability", () => {
    it("should disable triggers explicitly before data repair", async () => {
      const source = await readSourceFile(DATA_REPAIR_MIGRATION);
      const disable = findInSource(
        source,
        /ALTER\s+TABLE\s+public\.stock_events\s+DISABLE\s+TRIGGER\s+trg_stock_events_no_update/i
      );
      expect(disable.length).toBe(1);
    });

    it("should re-enable triggers after data repair", async () => {
      const source = await readSourceFile(DATA_REPAIR_MIGRATION);
      const enable = findInSource(
        source,
        /ALTER\s+TABLE\s+public\.stock_events\s+ENABLE\s+TRIGGER\s+trg_stock_events_no_update/i
      );
      expect(enable.length).toBe(1);
    });

    it("disable should come before enable in the migration", async () => {
      const source = await readSourceFile(DATA_REPAIR_MIGRATION);
      const disableIdx = source.indexOf("DISABLE TRIGGER trg_stock_events_no_update");
      const enableIdx = source.indexOf("ENABLE TRIGGER trg_stock_events_no_update");
      expect(disableIdx).toBeGreaterThan(-1);
      expect(enableIdx).toBeGreaterThan(-1);
      expect(disableIdx).toBeLessThan(enableIdx);
    });
  });

  // ---------------------------------------------------------------------------
  // stock_documents cannot be deleted via RLS
  // ---------------------------------------------------------------------------
  describe("Stock documents deletion prevention", () => {
    it("should have a DELETE policy on stock_documents that blocks all deletes (USING false)", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const deletePolicy = findInSource(
        source,
        /CREATE\s+POLICY\s+"Users cannot delete stock documents"\s+ON\s+public\.stock_documents\s+FOR\s+DELETE\s+USING\s*\(\s*false\s*\)/i
      );
      expect(deletePolicy.length).toBe(1);
    });
  });
});
