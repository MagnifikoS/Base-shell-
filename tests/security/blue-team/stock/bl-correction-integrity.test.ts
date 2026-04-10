/**
 * BL-01: BL Correction Chain Integrity Defense
 *
 * Verifies correction chain integrity for BL-APP documents:
 *   - corrects_document_id FK exists on stock_documents (self-referential)
 *   - corrections_count column on bl_app_documents
 *   - RECEIPT_CORRECTION type is a valid stock_document_type
 *   - BL soft-delete uses voided_at instead of hard delete
 *   - Correction creates a proper RECEIPT_CORRECTION document via fn_post_stock_document
 *   - Query filters exclude voided BL-APP documents
 *   - stock_document_id UNIQUE constraint + ON DELETE RESTRICT on bl_app_documents
 *
 * SSOT: supabase/migrations/20260216145403_*.sql (RECEIPT_CORRECTION schema)
 *       supabase/migrations/20260217120000_bl_app_soft_delete.sql
 *       supabase/migrations/20260213135124_*.sql (bl_app_documents creation)
 *       src/modules/blApp/hooks/useCreateCorrection.ts
 *       src/modules/blApp/services/blAppService.ts
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

const RECEIPT_CORRECTION_MIGRATION =
  "supabase/migrations/20260216145403_ce99a1a3-ddf4-48e1-92f7-4591b7300aa6.sql";

const BL_SOFT_DELETE_MIGRATION = "supabase/migrations/20260217120000_bl_app_soft_delete.sql";

const BL_APP_CREATION_MIGRATION =
  "supabase/migrations/20260213135124_23fb8026-3c69-45a2-a498-9aa9fbd777b0.sql";

const USE_CREATE_CORRECTION = "src/modules/blApp/hooks/useCreateCorrection.ts";

const BL_APP_SERVICE = "src/modules/blApp/services/blAppService.ts";

describe("BL-01 Defense: BL Correction Chain Integrity", () => {
  // ---------------------------------------------------------------------------
  // corrects_document_id foreign key on stock_documents
  // ---------------------------------------------------------------------------
  describe("corrects_document_id foreign key", () => {
    it("should add corrects_document_id column to stock_documents", async () => {
      const source = await readSourceFile(RECEIPT_CORRECTION_MIGRATION);
      const col = findInSource(
        source,
        /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+corrects_document_id\s+UUID/i
      );
      expect(col.length).toBe(1);
    });

    it("should have self-referential FK to stock_documents(id)", async () => {
      const source = await readSourceFile(RECEIPT_CORRECTION_MIGRATION);
      const fk = findInSource(
        source,
        /corrects_document_id\s+UUID\s+REFERENCES\s+public\.stock_documents\(id\)/i
      );
      expect(fk.length).toBe(1);
    });

    it("should have partial index for fast correction lookup", async () => {
      const source = await readSourceFile(RECEIPT_CORRECTION_MIGRATION);
      const idx = findInSource(
        source,
        /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_stock_documents_corrects_document_id/i
      );
      expect(idx.length).toBe(1);
    });

    it("partial index should filter WHERE corrects_document_id IS NOT NULL", async () => {
      const source = await readSourceFile(RECEIPT_CORRECTION_MIGRATION);
      const where = findInSource(source, /WHERE\s+corrects_document_id\s+IS\s+NOT\s+NULL/i);
      expect(where.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // corrections_count on bl_app_documents
  // ---------------------------------------------------------------------------
  describe("corrections_count on bl_app_documents", () => {
    it("should add corrections_count column with NOT NULL DEFAULT 0", async () => {
      const source = await readSourceFile(RECEIPT_CORRECTION_MIGRATION);
      const col = findInSource(
        source,
        /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+corrections_count\s+INT\s+NOT\s+NULL\s+DEFAULT\s+0/i
      );
      expect(col.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // RECEIPT_CORRECTION enum values
  // ---------------------------------------------------------------------------
  describe("RECEIPT_CORRECTION type in enums", () => {
    it("should add RECEIPT_CORRECTION to stock_document_type enum", async () => {
      const source = await readSourceFile(RECEIPT_CORRECTION_MIGRATION);
      const enumAdd = findInSource(
        source,
        /ALTER\s+TYPE\s+public\.stock_document_type\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+'RECEIPT_CORRECTION'/i
      );
      expect(enumAdd.length).toBe(1);
    });

    it("should add RECEIPT_CORRECTION to stock_event_type enum", async () => {
      const source = await readSourceFile(RECEIPT_CORRECTION_MIGRATION);
      const enumAdd = findInSource(
        source,
        /ALTER\s+TYPE\s+public\.stock_event_type\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+'RECEIPT_CORRECTION'/i
      );
      expect(enumAdd.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // BL soft-delete (voided_at) instead of hard delete
  // ---------------------------------------------------------------------------
  describe("BL soft-delete via voided_at (STK-BL-018)", () => {
    it("should add voided_at column to bl_app_documents", async () => {
      const source = await readSourceFile(BL_SOFT_DELETE_MIGRATION);
      const col = findInSource(
        source,
        /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+voided_at\s+timestamptz/i
      );
      expect(col.length).toBe(1);
    });

    it("should add void_reason column to bl_app_documents", async () => {
      const source = await readSourceFile(BL_SOFT_DELETE_MIGRATION);
      const col = findInSource(source, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+void_reason\s+text/i);
      expect(col.length).toBe(1);
    });

    it("should create partial index for efficient filtering of non-voided documents", async () => {
      const source = await readSourceFile(BL_SOFT_DELETE_MIGRATION);
      const idx = findInSource(
        source,
        /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_bl_app_documents_voided_at/i
      );
      expect(idx.length).toBe(1);
    });

    it("partial index should filter WHERE voided_at IS NULL", async () => {
      const source = await readSourceFile(BL_SOFT_DELETE_MIGRATION);
      const where = findInSource(source, /WHERE\s+voided_at\s+IS\s+NULL/i);
      expect(where.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // bl_app_documents → stock_documents ON DELETE RESTRICT
  // ---------------------------------------------------------------------------
  describe("BL-APP referential integrity", () => {
    it("bl_app_documents.stock_document_id should be UNIQUE", async () => {
      const source = await readSourceFile(BL_APP_CREATION_MIGRATION);
      const unique = findInSource(source, /stock_document_id\s+UUID\s+NOT\s+NULL\s+UNIQUE/i);
      expect(unique.length).toBe(1);
    });

    it("should use ON DELETE RESTRICT to prevent orphan BL-APP documents", async () => {
      const source = await readSourceFile(BL_APP_CREATION_MIGRATION);
      const restrict = findInSource(
        source,
        /stock_document_id\s+UUID\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+public\.stock_documents\(id\)\s+ON\s+DELETE\s+RESTRICT/i
      );
      expect(restrict.length).toBe(1);
    });

    it("bl_app_documents.status should be CHECK constrained to DRAFT or FINAL", async () => {
      const source = await readSourceFile(BL_APP_CREATION_MIGRATION);
      const check = findInSource(
        source,
        /CHECK\s*\(\s*status\s+IN\s*\(\s*'DRAFT',\s*'FINAL'\s*\)\s*\)/i
      );
      expect(check.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // useCreateCorrection hook integrity
  // ---------------------------------------------------------------------------
  describe("useCreateCorrection hook (frontend)", () => {
    it("should require authentication", async () => {
      const source = await readSourceFile(USE_CREATE_CORRECTION);
      const authCheck = findInSource(source, /if\s*\(\s*!user\?\.id\s*\)/);
      expect(authCheck.length).toBe(1);
    });

    it("should create RECEIPT_CORRECTION document type", async () => {
      const source = await readSourceFile(USE_CREATE_CORRECTION);
      const type = findInSource(source, /type:\s*["']RECEIPT_CORRECTION["']/);
      expect(type.length).toBeGreaterThanOrEqual(1);
    });

    it("should set corrects_document_id to link correction to original", async () => {
      const source = await readSourceFile(USE_CREATE_CORRECTION);
      const link = findInSource(source, /corrects_document_id:\s*params\.originalStockDocumentId/);
      expect(link.length).toBeGreaterThanOrEqual(1);
    });

    it("should use fn_post_stock_document RPC for atomic posting", async () => {
      const source = await readSourceFile(USE_CREATE_CORRECTION);
      const rpc = findInSource(source, /supabase\.rpc\(\s*["']fn_post_stock_document["']/);
      expect(rpc.length).toBe(1);
    });

    it("should use generateIdempotencyKey for deduplication", async () => {
      const source = await readSourceFile(USE_CREATE_CORRECTION);
      const idempotency = findInSource(source, /generateIdempotencyKey/);
      expect(idempotency.length).toBeGreaterThanOrEqual(1);
    });

    it("should recompute corrections_count from source of truth after successful post", async () => {
      const source = await readSourceFile(USE_CREATE_CORRECTION);
      const recompute = findInSource(
        source,
        /corrects_document_id.*params\.originalStockDocumentId[\s\S]*?status.*POSTED[\s\S]*?corrections_count/s
      );
      expect(recompute.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // BL service soft-delete implementation
  // ---------------------------------------------------------------------------
  describe("blAppService.ts soft-delete implementation", () => {
    it("voidBlAppDocument should set voided_at timestamp", async () => {
      const source = await readSourceFile(BL_APP_SERVICE);
      const voidedAt = findInSource(source, /voided_at:\s*new\s+Date\(\)\.toISOString\(\)/);
      expect(voidedAt.length).toBe(1);
    });

    it("voidBlAppDocument should set void_reason", async () => {
      const source = await readSourceFile(BL_APP_SERVICE);
      const voidReason = findInSource(source, /void_reason:\s*voidReason/);
      expect(voidReason.length).toBe(1);
    });

    it("hard deleteBlAppDocument should be marked as DEPRECATED", async () => {
      const source = await readSourceFile(BL_APP_SERVICE);
      const deprecated = findInSource(source, /DEPRECATED.*prefer\s+voidBlAppDocument/i);
      expect(deprecated.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Query-level soft-delete filtering
  // ---------------------------------------------------------------------------
  describe("Query-level soft-delete filtering", () => {
    it("fetchBlAppByStockDocumentId should filter voided_at IS NULL", async () => {
      const source = await readSourceFile(BL_APP_SERVICE);
      // Find the function and check for .is("voided_at", null) filter
      const fnStart = source.indexOf("fetchBlAppByStockDocumentId");
      const fnBody = source.substring(fnStart, source.indexOf("\n}", fnStart) + 2);
      const voidedFilter = findInSource(fnBody, /\.is\(\s*["']voided_at["'],\s*null\s*\)/);
      expect(voidedFilter.length).toBe(1);
    });

    it("fetchBlAppDocumentsByMonth should filter voided_at IS NULL", async () => {
      const source = await readSourceFile(BL_APP_SERVICE);
      const fnStart = source.indexOf("fetchBlAppDocumentsByMonth");
      const fnBody = source.substring(fnStart, source.indexOf("\n}", fnStart) + 2);
      const voidedFilter = findInSource(fnBody, /\.is\(\s*["']voided_at["'],\s*null\s*\)/);
      expect(voidedFilter.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // RLS on bl_app_documents
  // ---------------------------------------------------------------------------
  describe("BL-APP RLS policies", () => {
    it("should have RLS enabled on bl_app_documents", async () => {
      const source = await readSourceFile(BL_APP_CREATION_MIGRATION);
      const rls = findInSource(
        source,
        /ALTER\s+TABLE\s+public\.bl_app_documents\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
      );
      expect(rls.length).toBe(1);
    });

    it("should have SELECT policy scoped to user establishments", async () => {
      const source = await readSourceFile(BL_APP_CREATION_MIGRATION);
      const selectPolicy = findInSource(
        source,
        /CREATE\s+POLICY\s+["']bl_app_documents_select["'][\s\S]*?get_user_establishment_ids/i
      );
      expect(selectPolicy.length).toBe(1);
    });

    it("should have INSERT policy scoped to user establishments", async () => {
      const source = await readSourceFile(BL_APP_CREATION_MIGRATION);
      const insertPolicy = findInSource(
        source,
        /CREATE\s+POLICY\s+["']bl_app_documents_insert["'][\s\S]*?get_user_establishment_ids/i
      );
      expect(insertPolicy.length).toBe(1);
    });

    it("should have UPDATE policy scoped to user establishments", async () => {
      const source = await readSourceFile(BL_APP_CREATION_MIGRATION);
      const updatePolicy = findInSource(
        source,
        /CREATE\s+POLICY\s+["']bl_app_documents_update["'][\s\S]*?get_user_establishment_ids/i
      );
      expect(updatePolicy.length).toBe(1);
    });
  });
});
