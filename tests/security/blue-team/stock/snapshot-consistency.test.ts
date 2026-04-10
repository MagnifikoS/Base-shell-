/**
 * STK-04: Snapshot Transactional Consistency Defense
 *
 * Verifies that zone_stock_snapshots are always consistent with stock_events:
 *   - Event INSERT happens within the same transaction as document status update
 *   - Row-level locking (FOR UPDATE) prevents stale reads during posting
 *   - snapshot_version_id links events to the correct snapshot
 *   - Zone snapshots are checked for existence before posting/voiding
 *   - The fn_post_stock_document function is a single PL/pgSQL block (atomic)
 *   - Idempotency key prevents duplicate posts
 *
 * SSOT: supabase/migrations/20260216230004_fix_stock_void_and_locking.sql
 *       supabase/migrations/20260212155624_*.sql (initial schema)
 *       src/modules/stockLedger/engine/postGuards.ts
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

const STOCK_VOID_LOCKING_MIGRATION =
  "supabase/migrations/20260216230004_fix_stock_void_and_locking.sql";

const STOCK_SCHEMA_MIGRATION =
  "supabase/migrations/20260212155624_51d66c13-012d-4924-8982-82c1917327e4.sql";

const POST_GUARDS = "src/modules/stockLedger/engine/postGuards.ts";

describe("STK-04 Defense: Snapshot Transactional Consistency", () => {
  // ---------------------------------------------------------------------------
  // Atomic function — single PL/pgSQL block
  // ---------------------------------------------------------------------------
  describe("Atomic transaction in fn_post_stock_document", () => {
    it("fn_post_stock_document should be a PL/pgSQL function (implicit transaction)", async () => {
      const source = await readSourceFile(STOCK_VOID_LOCKING_MIGRATION);
      const postFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_post_stock_document"
      );
      const postFnBody = source.substring(postFnStart, postFnStart + 500);

      const plpgsql = findInSource(postFnBody, /LANGUAGE\s+plpgsql/i);
      expect(plpgsql.length).toBe(1);
    });

    it("fn_void_stock_document should also be a PL/pgSQL function (implicit transaction)", async () => {
      const source = await readSourceFile(STOCK_VOID_LOCKING_MIGRATION);
      const voidFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_void_stock_document"
      );
      const voidFnBody = source.substring(voidFnStart, voidFnStart + 300);

      const plpgsql = findInSource(voidFnBody, /LANGUAGE\s+plpgsql/i);
      expect(plpgsql.length).toBe(1);
    });

    it("document status update and event INSERT are in same function body (same transaction)", async () => {
      const source = await readSourceFile(STOCK_VOID_LOCKING_MIGRATION);
      const postFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_post_stock_document"
      );
      // The function body extends to the end of the file (last function in migration)
      const postFnBody = source.substring(postFnStart);

      // Both status update and event insert happen in the same function body
      const statusUpdate = findInSource(postFnBody, /SET\s+status\s*=\s*'POSTED'/i);
      const eventInsert = findInSource(postFnBody, /INSERT\s+INTO\s+stock_events/i);

      expect(statusUpdate.length).toBeGreaterThanOrEqual(1);
      expect(eventInsert.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // snapshot_version_id links events to correct snapshot
  // ---------------------------------------------------------------------------
  describe("snapshot_version_id linkage", () => {
    it("stock_events table should have snapshot_version_id column", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const col = findInSource(source, /snapshot_version_id/i);
      expect(col.length).toBeGreaterThanOrEqual(1);
    });

    it("fn_post_stock_document should join zone_stock_snapshots to get snapshot_version_id", async () => {
      const source = await readSourceFile(STOCK_VOID_LOCKING_MIGRATION);
      const postFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_post_stock_document"
      );
      const postFnBody = source.substring(postFnStart);

      const snapshotJoin = findInSource(postFnBody, /JOIN\s+zone_stock_snapshots\s+zss/i);
      expect(snapshotJoin.length).toBeGreaterThanOrEqual(1);
    });

    it("event INSERT should use zss.snapshot_version_id from the JOIN", async () => {
      const source = await readSourceFile(STOCK_VOID_LOCKING_MIGRATION);
      const postFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_post_stock_document"
      );
      const postFnBody = source.substring(postFnStart);

      const snapshotRef = findInSource(postFnBody, /zss\.snapshot_version_id/i);
      expect(snapshotRef.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Snapshot existence verified before posting
  // ---------------------------------------------------------------------------
  describe("Snapshot existence check before posting", () => {
    it("fn_post_stock_document should check NO_ACTIVE_SNAPSHOT_FOR_PRODUCT_ZONE", async () => {
      const source = await readSourceFile(STOCK_VOID_LOCKING_MIGRATION);
      const postFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_post_stock_document"
      );
      const postFnBody = source.substring(postFnStart);

      const snapshotCheck = findInSource(postFnBody, /NO_ACTIVE_SNAPSHOT_FOR_PRODUCT_ZONE/i);
      expect(snapshotCheck.length).toBeGreaterThanOrEqual(1);
    });

    it("fn_void_stock_document should check NO_ACTIVE_SNAPSHOT_FOR_VOID_ZONES", async () => {
      const source = await readSourceFile(STOCK_VOID_LOCKING_MIGRATION);
      const voidFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_void_stock_document"
      );
      const voidFnEnd = source.indexOf("CREATE OR REPLACE FUNCTION public.fn_post_stock_document");
      const voidFnBody = source.substring(voidFnStart, voidFnEnd);

      const snapshotCheck = findInSource(voidFnBody, /NO_ACTIVE_SNAPSHOT_FOR_VOID_ZONES/i);
      expect(snapshotCheck.length).toBeGreaterThanOrEqual(1);
    });

    it("frontend postGuards should check zoneSnapshot is not null", async () => {
      const source = await readSourceFile(POST_GUARDS);
      const snapshotCheck = findInSource(source, /!input\.zoneSnapshot/);
      expect(snapshotCheck.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Row-level locking ensures consistent reads
  // ---------------------------------------------------------------------------
  describe("Row-level locking for consistent snapshot reads", () => {
    it("fn_post_stock_document should lock snapshot rows BEFORE negative stock check", async () => {
      const source = await readSourceFile(STOCK_VOID_LOCKING_MIGRATION);
      const postFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_post_stock_document"
      );
      const postFnBody = source.substring(postFnStart);

      // FOR UPDATE should appear before the negative stock check
      const forUpdateIdx = postFnBody.indexOf("FOR UPDATE");
      const negativeCheckIdx = postFnBody.indexOf("NEGATIVE_STOCK");

      expect(forUpdateIdx).toBeGreaterThan(-1);
      expect(negativeCheckIdx).toBeGreaterThan(-1);
      expect(forUpdateIdx).toBeLessThan(negativeCheckIdx);
    });

    it("fn_void_stock_document should lock snapshot rows BEFORE negative stock check", async () => {
      const source = await readSourceFile(STOCK_VOID_LOCKING_MIGRATION);
      const voidFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_void_stock_document"
      );
      const voidFnEnd = source.indexOf("CREATE OR REPLACE FUNCTION public.fn_post_stock_document");
      const voidFnBody = source.substring(voidFnStart, voidFnEnd);

      const forUpdateIdx = voidFnBody.indexOf("FOR UPDATE");
      const negativeCheckIdx = voidFnBody.indexOf("NEGATIVE_STOCK_ON_VOID");

      expect(forUpdateIdx).toBeGreaterThan(-1);
      expect(negativeCheckIdx).toBeGreaterThan(-1);
      expect(forUpdateIdx).toBeLessThan(negativeCheckIdx);
    });
  });

  // ---------------------------------------------------------------------------
  // Idempotency prevents duplicate posts
  // ---------------------------------------------------------------------------
  describe("Idempotency guard", () => {
    it("fn_post_stock_document should check idempotency_key", async () => {
      const source = await readSourceFile(STOCK_VOID_LOCKING_MIGRATION);
      const postFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_post_stock_document"
      );
      const postFnBody = source.substring(postFnStart);

      const idempotency = findInSource(postFnBody, /idempotency_key/i);
      expect(idempotency.length).toBeGreaterThanOrEqual(1);
    });

    it("should return idempotent: true if already posted with same key", async () => {
      const source = await readSourceFile(STOCK_VOID_LOCKING_MIGRATION);
      const postFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_post_stock_document"
      );
      const postFnBody = source.substring(postFnStart);

      const idempotentReturn = findInSource(postFnBody, /'idempotent',\s*true/i);
      expect(idempotentReturn.length).toBeGreaterThanOrEqual(1);
    });

    it("frontend postGuards should generate deterministic idempotency key", async () => {
      const source = await readSourceFile(POST_GUARDS);
      const genKey = findInSource(source, /export\s+function\s+generateIdempotencyKey/);
      expect(genKey.length).toBe(1);

      // Key should NOT use Date.now() in the return statement (non-deterministic)
      // The comment mentions Date.now() but the actual return uses deterministic string concat
      const fnStart = source.indexOf("export function generateIdempotencyKey");
      const fnEnd = source.indexOf("\n}", fnStart) + 2;
      const fnBody = source.substring(fnStart, fnEnd);
      // Check the return line doesn't use Date.now() (comments are OK)
      const returnLine = fnBody.split("\n").find((l: string) => l.trim().startsWith("return"));
      expect(returnLine).toBeDefined();
      expect(returnLine).not.toContain("Date.now()");
    });
  });

  // ---------------------------------------------------------------------------
  // Unique constraint prevents duplicate idempotency keys at DB level
  // ---------------------------------------------------------------------------
  describe("DB-level idempotency uniqueness", () => {
    it("should have a unique index on idempotency_key per establishment", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const uniqueIdx = findInSource(
        source,
        /CREATE\s+UNIQUE\s+INDEX\s+uq_stock_documents_idempotency/i
      );
      expect(uniqueIdx.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // zone_stock_snapshots has updated_at trigger
  // ---------------------------------------------------------------------------
  describe("Zone stock snapshot updated_at trigger", () => {
    it("should have an updated_at trigger on zone_stock_snapshots", async () => {
      const source = await readSourceFile(STOCK_SCHEMA_MIGRATION);
      const trigger = findInSource(
        source,
        /CREATE\s+TRIGGER\s+update_zone_stock_snapshots_updated_at/i
      );
      expect(trigger.length).toBe(1);
    });
  });
});
