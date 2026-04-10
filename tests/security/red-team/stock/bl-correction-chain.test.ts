/**
 * BL-01 -- BL Correction Chain Integrity Not Enforced
 *
 * Target:
 *   supabase/migrations/20260216145403_*.sql (corrects_document_id + corrections_count)
 *   src/modules/blApp/hooks/useCreateCorrection.ts (correction creation flow)
 *   src/modules/blApp/services/blAppService.ts (BL CRUD)
 *   src/modules/blApp/types.ts (BL document types)
 *
 * Vulnerability:
 *   The BL correction chain has several integrity gaps:
 *
 *   1. corrects_document_id has a FK to stock_documents(id) but NO CHECK
 *      constraint ensuring the referenced document is a RECEIPT (not WITHDRAWAL,
 *      ADJUSTMENT, or another RECEIPT_CORRECTION). A correction can reference
 *      ANY stock document.
 *
 *   2. corrections_count on bl_app_documents is maintained CLIENT-SIDE via
 *      a SELECT COUNT + UPDATE sequence (not a trigger). This is not atomic
 *      and can become inconsistent under concurrent corrections.
 *
 *   3. There is no depth limit on correction chains. A RECEIPT_CORRECTION
 *      can reference another RECEIPT_CORRECTION, creating unbounded chains.
 *      The corrects_document_id FK only requires the target to be a valid
 *      stock_documents row, not specifically a RECEIPT.
 *
 *   4. There is no check that the document being corrected is POSTED
 *      (the correction could reference a VOID or DRAFT document).
 *
 *   5. The bl_app_documents.corrections_count can drift from the actual
 *      count of POSTED corrections due to the non-atomic update pattern.
 *
 * PoC:
 *   1. Verify corrects_document_id FK has no type constraint
 *   2. Verify corrections_count is client-maintained (not trigger)
 *   3. Verify no depth limit on correction chains
 *   4. Verify no status check on referenced document
 *   5. Verify the count update is a TOCTOU pattern
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("BL-01: BL Correction Chain Integrity Not Enforced", () => {
  const CORRECTION_MIGRATION =
    "supabase/migrations/20260216145403_ce99a1a3-ddf4-48e1-92f7-4591b7300aa6.sql";
  const USE_CREATE_CORRECTION = "src/modules/blApp/hooks/useCreateCorrection.ts";
  const _BL_SERVICE = "src/modules/blApp/services/blAppService.ts";
  const BL_TYPES = "src/modules/blApp/types.ts";

  it("should confirm corrects_document_id is a simple FK with no type constraint", async () => {
    const source = await readSourceFile(CORRECTION_MIGRATION);

    // The FK references stock_documents(id) with no additional CHECK
    const fk = findInSource(
      source,
      /corrects_document_id UUID REFERENCES public\.stock_documents\(id\)/g
    );
    expect(fk.length).toBe(1);

    // No CHECK constraint to ensure referenced document is a RECEIPT
    const typeCheck = findInSource(
      source,
      /CHECK.*corrects_document_id.*type.*RECEIPT|CHECK.*type.*RECEIPT.*corrects_document_id/gi
    );
    expect(typeCheck.length).toBe(0);

    // No CHECK constraint to ensure referenced document is POSTED
    const statusCheck = findInSource(
      source,
      /CHECK.*corrects_document_id.*status.*POSTED|CHECK.*status.*POSTED.*corrects_document_id/gi
    );
    expect(statusCheck.length).toBe(0);
  });

  it("should confirm DB trigger trg_maintain_corrections_count NOW exists [FIXED]", async () => {
    // The trigger was added in migration 20260217130001_bl_correction_chain_integrity.sql
    const migrationSource = await readSourceFile(
      "supabase/migrations/20260217130001_bl_correction_chain_integrity.sql"
    );

    // Trigger trg_maintain_corrections_count is now created
    const triggerCreate = findInSource(
      migrationSource,
      /CREATE TRIGGER trg_maintain_corrections_count/g
    );
    expect(triggerCreate.length).toBe(1);

    // The trigger fires AFTER INSERT OR UPDATE OF status on stock_documents
    const triggerTiming = findInSource(migrationSource, /AFTER INSERT OR UPDATE OF status/g);
    expect(triggerTiming.length).toBe(1);

    // The trigger function counts POSTED corrections atomically (no more TOCTOU)
    const atomicCount = findInSource(
      migrationSource,
      /SELECT COUNT\(\*\) INTO v_count[\s\S]*?WHERE corrects_document_id = v_original_doc_id[\s\S]*?AND status = 'POSTED'/g
    );
    expect(atomicCount.length).toBe(1);

    // The trigger updates bl_app_documents.corrections_count directly
    const updateBl = findInSource(
      migrationSource,
      /UPDATE bl_app_documents[\s\S]*?SET corrections_count = v_count/g
    );
    expect(updateBl.length).toBe(1);

    // Also verify: the validation trigger ensures corrections only target RECEIPT + POSTED docs
    const validationTrigger = findInSource(
      migrationSource,
      /CREATE TRIGGER trg_validate_correction_target/g
    );
    expect(validationTrigger.length).toBe(1);
  });

  it("should confirm corrections_count is updated via client-side SELECT COUNT + UPDATE (TOCTOU)", async () => {
    const source = await readSourceFile(USE_CREATE_CORRECTION);

    // Step 1: Client queries the count of POSTED corrections
    const selectCount = findInSource(source, /\.from\("stock_documents"\)[\s\S]*?count: "exact"/g);
    expect(selectCount.length).toBe(1);

    // Step 2: Client updates bl_app_documents.corrections_count with the result
    const updateCount = findInSource(
      source,
      /\.from\("bl_app_documents"\)[\s\S]*?\.update\(\{ corrections_count/g
    );
    expect(updateCount.length).toBe(1);

    // These are TWO separate operations, NOT atomic
    // Between the SELECT COUNT and the UPDATE, another correction could be posted
    // This leads to corrections_count drift
  });

  it("should confirm useCreateCorrection does NOT check if referenced document is a RECEIPT", async () => {
    const source = await readSourceFile(USE_CREATE_CORRECTION);

    // The function accepts originalStockDocumentId without type validation
    const paramDef = findInSource(source, /originalStockDocumentId: string/g);
    expect(paramDef.length).toBe(1);

    // The word "RECEIPT" may appear in type definitions or correction type handling
    // but there's no pre-flight query to verify the original doc IS a receipt
    const statusQuery = findInSource(
      source,
      /\.eq\("type",\s*"RECEIPT"\).*\.single\(\)|SELECT.*type.*FROM.*stock_documents/gi
    );
    expect(statusQuery.length).toBe(0);
  });

  it("should confirm useCreateCorrection does NOT check if referenced document is POSTED", async () => {
    const source = await readSourceFile(USE_CREATE_CORRECTION);

    // No status check on the original document
    // The correction could reference a DRAFT or VOID document
    const statusCheck = findInSource(
      source,
      /\.eq\("status".*"POSTED"\)[\s\S]*?originalStockDocumentId|check.*posted.*original/gi
    );
    expect(statusCheck.length).toBe(0);

    // The only status check is on finding existing DRAFT correction (not the target)
    const draftCheck = findInSource(source, /\.eq\("status", "DRAFT"\)/g);
    expect(draftCheck.length).toBe(1);
  });

  it("should confirm no depth limit prevents correction-of-correction chains", async () => {
    const source = await readSourceFile(USE_CREATE_CORRECTION);

    // The correction creates a RECEIPT_CORRECTION document with corrects_document_id
    // But there's no check that the target is NOT itself a RECEIPT_CORRECTION
    const correctionType = findInSource(source, /type.*RECEIPT_CORRECTION/g);
    expect(correctionType.length).toBeGreaterThan(0);

    // The corrects_document_id points to any stock_documents row
    const correctsField = findInSource(
      source,
      /corrects_document_id: params\.originalStockDocumentId/g
    );
    expect(correctsField.length).toBe(1);

    // No depth check (e.g., "SELECT type FROM stock_documents WHERE id = originalStockDocumentId")
    const depthCheck = findInSource(source, /depth|chain_length|max_corrections|recursive/gi);
    expect(depthCheck.length).toBe(0);
  });

  it("should confirm bl_app_documents status field allows only DRAFT and FINAL (not VOIDED at DB level)", async () => {
    const source = await readSourceFile(
      "supabase/migrations/20260213135124_23fb8026-3c69-45a2-a498-9aa9fbd777b0.sql"
    );

    // The CHECK constraint only allows DRAFT and FINAL
    const checkConstraint = findInSource(source, /CHECK \(status IN \('DRAFT', 'FINAL'\)\)/g);
    expect(checkConstraint.length).toBe(1);

    // But the TypeScript type includes VOIDED
    const tsSource = await readSourceFile(BL_TYPES);
    const tsType = findInSource(tsSource, /BlAppStatus.*DRAFT.*FINAL.*VOIDED/g);
    expect(tsType.length).toBe(1);

    // This means: setting status to 'VOIDED' via the API would fail at DB level
    // But soft-delete via voided_at column works (separate column, added later)
  });

  it("should confirm corrections can be created by any user with stock module access", async () => {
    const source = await readSourceFile(USE_CREATE_CORRECTION);

    // No permission check for creating corrections
    const permCheck = findInSource(
      source,
      /usePermissions|hasPermission|isAdmin|isManager|PermissionGuard/gi
    );
    expect(permCheck.length).toBe(0);

    // Only checks if user is authenticated
    const authCheck = findInSource(source, /user\?.id.*Non authentifié|user\.id/g);
    expect(authCheck.length).toBeGreaterThan(0);
  });

  it("should confirm the correction → POST flow uses fn_post_stock_document (good: validated)", async () => {
    const source = await readSourceFile(USE_CREATE_CORRECTION);

    // After creating the correction document, it calls fn_post_stock_document
    const rpcPost = findInSource(source, /supabase\.rpc\("fn_post_stock_document"/g);
    expect(rpcPost.length).toBe(1);

    // This means the correction goes through the same negative stock check
    // and locking as regular documents (partial mitigation)
    // generateIdempotencyKey appears twice: import + usage
    const idempotencyKey = findInSource(source, /generateIdempotencyKey/g);
    expect(idempotencyKey.length).toBeGreaterThan(0);
  });
});
