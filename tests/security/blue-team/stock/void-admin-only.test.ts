/**
 * STK-03: Void Authorization Defense
 *
 * Verifies that stock document void operations are properly restricted:
 *   - fn_void_stock_document is SECURITY DEFINER (bypasses RLS)
 *   - EXECUTE is revoked from authenticated/anon/public roles
 *   - Only service_role (edge functions) can call the void RPC
 *   - Void requires a non-empty reason (audit trail)
 *   - Void checks POSTED status before allowing
 *   - Void creates inverse events for audit trail (no hard deletion)
 *   - Void balance verification ensures sum of original + void = 0
 *
 * SSOT: supabase/migrations/20260216230003_revoke_stock_rpc_direct_access.sql
 *       supabase/migrations/20260216230004_fix_stock_void_and_locking.sql
 *       src/modules/stockLedger/hooks/useVoidDocument.ts
 *
 * GAP DOCUMENTED: No explicit has_module_access or is_admin check inside
 * fn_void_stock_document. Authorization is enforced at the edge function
 * layer (service_role gating) and DB REVOKE, not inside the function body.
 * The UI does not check role/permission before showing the void button.
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

const REVOKE_MIGRATION = "supabase/migrations/20260216230003_revoke_stock_rpc_direct_access.sql";

const VOID_LOCKING_MIGRATION = "supabase/migrations/20260216230004_fix_stock_void_and_locking.sql";

const USE_VOID_DOCUMENT = "src/modules/stockLedger/hooks/useVoidDocument.ts";

const DOCUMENT_HISTORY_VIEW = "src/modules/stockLedger/components/DocumentHistoryView.tsx";

describe("STK-03 Defense: Void Authorization", () => {
  // ---------------------------------------------------------------------------
  // fn_void_stock_document is SECURITY DEFINER
  // ---------------------------------------------------------------------------
  describe("SECURITY DEFINER isolation", () => {
    it("fn_void_stock_document should be SECURITY DEFINER", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      // Use CREATE OR REPLACE as boundary to isolate the void function from comments
      const voidFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_void_stock_document"
      );
      const voidFnEnd = source.indexOf("CREATE OR REPLACE FUNCTION public.fn_post_stock_document");
      const voidFnBody = source.substring(voidFnStart, voidFnEnd);

      const secDef = findInSource(voidFnBody, /SECURITY\s+DEFINER/i);
      expect(secDef.length).toBeGreaterThanOrEqual(1);
    });

    it("fn_void_stock_document should set search_path to 'public'", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const voidFnStart = source.indexOf(
        "CREATE OR REPLACE FUNCTION public.fn_void_stock_document"
      );
      const voidFnEnd = source.indexOf("CREATE OR REPLACE FUNCTION public.fn_post_stock_document");
      const voidFnBody = source.substring(voidFnStart, voidFnEnd);

      const searchPath = findInSource(voidFnBody, /SET\s+search_path\s+TO\s+'public'/i);
      expect(searchPath.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // REVOKE EXECUTE from all non-service roles (SEC-AUTH-006/018)
  // ---------------------------------------------------------------------------
  describe("REVOKE EXECUTE on fn_void_stock_document", () => {
    it("should revoke EXECUTE from authenticated role", async () => {
      const source = await readSourceFile(REVOKE_MIGRATION);
      const revoke = findInSource(
        source,
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_void_stock_document.*FROM\s+authenticated/i
      );
      expect(revoke.length).toBe(1);
    });

    it("should revoke EXECUTE from anon role", async () => {
      const source = await readSourceFile(REVOKE_MIGRATION);
      const revoke = findInSource(
        source,
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_void_stock_document.*FROM\s+anon/i
      );
      expect(revoke.length).toBe(1);
    });

    it("should revoke EXECUTE from public role", async () => {
      const source = await readSourceFile(REVOKE_MIGRATION);
      const revoke = findInSource(
        source,
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_void_stock_document.*FROM\s+public/i
      );
      expect(revoke.length).toBe(1);
    });

    it("should also revoke EXECUTE on fn_post_stock_document from authenticated", async () => {
      const source = await readSourceFile(REVOKE_MIGRATION);
      const revoke = findInSource(
        source,
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_post_stock_document.*FROM\s+authenticated/i
      );
      expect(revoke.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // REVOKE is re-applied after CREATE OR REPLACE in later migration
  // ---------------------------------------------------------------------------
  describe("REVOKE persistence after function rewrite", () => {
    it("should re-apply REVOKE in the void+locking migration (after CREATE OR REPLACE)", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const revokeVoid = findInSource(
        source,
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_void_stock_document.*FROM\s+authenticated/i
      );
      expect(revokeVoid.length).toBeGreaterThanOrEqual(1);
    });

    it("should re-apply REVOKE for fn_post_stock_document too", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const revokePost = findInSource(
        source,
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_post_stock_document.*FROM\s+authenticated/i
      );
      expect(revokePost.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Void operation requires valid preconditions
  // ---------------------------------------------------------------------------
  describe("Void preconditions in fn_void_stock_document", () => {
    it("should require document status = POSTED before voiding", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const statusCheck = findInSource(source, /v_doc\.status\s*!=\s*'POSTED'/i);
      expect(statusCheck.length).toBeGreaterThanOrEqual(1);
    });

    it("should return NOT_POSTED error for non-POSTED documents", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const notPosted = findInSource(source, /'NOT_POSTED'/i);
      expect(notPosted.length).toBeGreaterThanOrEqual(1);
    });

    it("should require non-empty void_reason (audit trail)", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const reasonCheck = findInSource(source, /VOID_REASON_REQUIRED/i);
      expect(reasonCheck.length).toBeGreaterThanOrEqual(1);
    });

    it("should check p_void_reason is not null or empty string", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const nullCheck = findInSource(
        source,
        /p_void_reason\s+IS\s+NULL\s+OR\s+TRIM\(p_void_reason\)\s*=\s*''/i
      );
      expect(nullCheck.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Void creates audit trail (inverse events, not deletion)
  // ---------------------------------------------------------------------------
  describe("Void creates audit trail via inverse events", () => {
    it("should INSERT inverse events with event_type VOID", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const voidInsert = findInSource(
        source,
        /INSERT\s+INTO\s+stock_events[\s\S]*?'VOID'::stock_event_type/i
      );
      expect(voidInsert.length).toBeGreaterThanOrEqual(1);
    });

    it("should negate delta_quantity_canonical (ROUND(-e.delta_quantity_canonical, 4))", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const negation = findInSource(source, /ROUND\(-e\.delta_quantity_canonical,\s*4\)/i);
      expect(negation.length).toBeGreaterThanOrEqual(1);
    });

    it("should set voids_event_id and voids_document_id for traceability", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const voidsEventId = findInSource(source, /voids_event_id/i);
      const voidsDocId = findInSource(source, /voids_document_id/i);
      expect(voidsEventId.length).toBeGreaterThanOrEqual(1);
      expect(voidsDocId.length).toBeGreaterThanOrEqual(1);
    });

    it("should verify balance (sum of original + void must = 0 per product)", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const balanceCheck = findInSource(source, /VOID_BALANCE_ERROR/i);
      expect(balanceCheck.length).toBe(1);
    });

    it("should use VOID_CONFLICT guard to prevent double-void", async () => {
      const source = await readSourceFile(VOID_LOCKING_MIGRATION);
      const conflict = findInSource(source, /VOID_CONFLICT/i);
      expect(conflict.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Frontend void hook requires authentication
  // ---------------------------------------------------------------------------
  describe("Frontend useVoidDocument hook", () => {
    it("should require authenticated user", async () => {
      const source = await readSourceFile(USE_VOID_DOCUMENT);
      const authCheck = findInSource(source, /if\s*\(\s*!user\?\.id\s*\)/);
      expect(authCheck.length).toBe(1);
    });

    it("should call stock-ledger edge function (not direct RPC — revoked)", async () => {
      const source = await readSourceFile(USE_VOID_DOCUMENT);
      // Must use edge function (service_role), NOT direct supabase.rpc (revoked per SEC-AUTH-006)
      const edgeFnCall = findInSource(source, /functions\.invoke\("stock-ledger\?action=void"/g);
      expect(edgeFnCall.length).toBe(1);
      // Must NOT call RPC directly (would get 403)
      const directRpc = findInSource(source, /supabase\.rpc\("fn_void_stock_document"/g);
      expect(directRpc.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // GAP: No role-based UI guard on void button
  // ---------------------------------------------------------------------------
  describe("GAP DOCUMENTATION: UI void button permission check", () => {
    it("KNOWN GAP: void button is shown to all users with POSTED status (no role check)", async () => {
      const source = await readSourceFile(DOCUMENT_HISTORY_VIEW);
      // The button is shown when doc.status === "POSTED" with no permission guard
      const voidButton = findInSource(source, /doc\.status\s*===\s*["']POSTED["'].*Annuler/s);
      // This test documents the gap: the button is visible without checking usePermissions
      // Defense relies on DB-level REVOKE (service_role only) rather than UI-level guard
      expect(voidButton.length).toBeGreaterThanOrEqual(1);

      // Verify there's NO usePermissions import for void-specific check
      const permissionImport = findInSource(source, /usePermissions/);
      // Gap: no permission check in DocumentHistoryView.tsx for void
      // This is acceptable because the DB REVOKE prevents direct RPC calls,
      // but a UI guard would be defense-in-depth
      expect(permissionImport.length).toBe(0);
    });
  });
});
