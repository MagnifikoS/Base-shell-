/**
 * STK-03 -- Stock Document Void Has No Admin-Only Restriction
 *
 * Target:
 *   supabase/migrations/20260216230004_*.sql (fn_void_stock_document)
 *   supabase/migrations/20260216230003_*.sql (revoke direct RPC access)
 *   src/modules/stockLedger/hooks/useVoidDocument.ts (client-side void hook)
 *   src/modules/stockLedger/components/VoidConfirmDialog.tsx (UI)
 *   src/modules/stockLedger/components/DocumentHistoryView.tsx (void button)
 *
 * Vulnerability:
 *   The void operation:
 *   1. fn_void_stock_document is SECURITY DEFINER and was revoked from
 *      authenticated/anon roles (SEC-AUTH-006/018) so it cannot be called
 *      directly via PostgREST RPC.
 *   2. HOWEVER, the client-side hook useVoidDocument.ts calls the RPC
 *      directly via supabase.rpc() - this suggests the revoke may not be
 *      effective, OR there is an edge function proxy not yet implemented.
 *   3. The VoidConfirmDialog has NO permission check (usePermissions).
 *   4. The DocumentHistoryView shows the void button to ALL users without
 *      checking for admin/manager role.
 *   5. The RPC function itself has NO internal role/permission check.
 *
 *   Impact: Any user with stock module access can void ANY posted document,
 *   effectively erasing stock movements. This is a destructive operation
 *   that should require elevated privileges.
 *
 * PoC:
 *   1. Confirm fn_void_stock_document has no role check
 *   2. Confirm useVoidDocument has no permission guard
 *   3. Confirm VoidConfirmDialog has no permission guard
 *   4. Confirm the RPC was revoked from authenticated (partial fix)
 *   5. Confirm the hook still calls RPC directly (inconsistency)
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("STK-03: Stock Document Void Has No Admin-Only Restriction", () => {
  const VOID_RPC_MIGRATION = "supabase/migrations/20260216230004_fix_stock_void_and_locking.sql";
  const REVOKE_MIGRATION = "supabase/migrations/20260216230003_revoke_stock_rpc_direct_access.sql";
  const USE_VOID_DOCUMENT = "src/modules/stockLedger/hooks/useVoidDocument.ts";
  const VOID_CONFIRM_DIALOG = "src/modules/stockLedger/components/VoidConfirmDialog.tsx";
  const DOCUMENT_HISTORY = "src/modules/stockLedger/components/DocumentHistoryView.tsx";

  it("should confirm fn_void_stock_document has NO internal role/permission check", async () => {
    const source = await readSourceFile(VOID_RPC_MIGRATION);

    // Find the void function definition
    const fnDef = findInSource(
      source,
      /CREATE OR REPLACE FUNCTION public\.fn_void_stock_document/g
    );
    expect(fnDef.length).toBe(1);

    // The function does NOT check the user's role or permissions
    const roleCheck = findInSource(
      source,
      /has_module_access|is_admin|admin_check|role_check|get_my_permissions/gi
    );
    expect(roleCheck.length).toBe(0);

    // The function accepts any p_voided_by UUID without verifying it matches auth.uid()
    const authUid = findInSource(source, /auth\.uid\(\)/g);
    expect(authUid.length).toBe(0);

    // The only validation is: document must be POSTED, reason must be provided
    const statusCheck = findInSource(source, /v_doc\.status != 'POSTED'/g);
    expect(statusCheck.length).toBe(1);
    const reasonCheck = findInSource(source, /p_void_reason IS NULL/g);
    expect(reasonCheck.length).toBe(1);
  });

  it("should confirm fn_void_stock_document is SECURITY DEFINER (bypasses RLS)", async () => {
    const source = await readSourceFile(VOID_RPC_MIGRATION);

    const securityDefiner = findInSource(source, /SECURITY DEFINER/g);
    expect(securityDefiner.length).toBeGreaterThan(0);
  });

  it("should confirm the RPC was revoked from authenticated role (SEC-AUTH-006/018)", async () => {
    const source = await readSourceFile(REVOKE_MIGRATION);

    // Revoked from authenticated
    const revokeAuth = findInSource(
      source,
      /REVOKE EXECUTE ON FUNCTION public\.fn_void_stock_document.*FROM authenticated/g
    );
    expect(revokeAuth.length).toBe(1);

    // Revoked from anon
    const revokeAnon = findInSource(
      source,
      /REVOKE EXECUTE ON FUNCTION public\.fn_void_stock_document.*FROM anon/g
    );
    expect(revokeAnon.length).toBe(1);

    // Revoked from public
    const revokePublic = findInSource(
      source,
      /REVOKE EXECUTE ON FUNCTION public\.fn_void_stock_document.*FROM public/g
    );
    expect(revokePublic.length).toBe(1);
  });

  it("should confirm useVoidDocument uses edge function (REVOKE applied — no more direct RPC)", async () => {
    const source = await readSourceFile(USE_VOID_DOCUMENT);

    // FIXED: The hook now calls the stock-ledger edge function (service_role)
    // because fn_void_stock_document was REVOKED from authenticated users (SEC-AUTH-006)
    const edgeFunctionCall = findInSource(
      source,
      /functions\.invoke\("stock-ledger\?action=void"/g
    );
    expect(edgeFunctionCall.length).toBe(1);

    // Must NOT call RPC directly anymore (would get 403)
    const directRpc = findInSource(source, /supabase\.rpc\("fn_void_stock_document"/g);
    expect(directRpc.length).toBe(0);
  });

  it("should confirm useVoidDocument now HAS permission check via usePermissions + can() [FIXED]", async () => {
    const source = await readSourceFile(USE_VOID_DOCUMENT);

    // usePermissions is now imported and used
    const usePermissionsImport = findInSource(source, /import.*usePermissions.*from/g);
    expect(usePermissionsImport.length).toBe(1);

    // can() is destructured from usePermissions
    const canDestructure = findInSource(source, /const \{ can \} = usePermissions\(\)/g);
    expect(canDestructure.length).toBe(1);

    // STK-03 fix: void requires write-level stock access
    const writeCheck = findInSource(source, /can\("stock", "write"\)/g);
    expect(writeCheck.length).toBe(1);

    // Returns VOID_ACCESS_DENIED error if permission check fails
    const accessDenied = findInSource(source, /VOID_ACCESS_DENIED/g);
    expect(accessDenied.length).toBe(1);

    // Still checks auth (user?.id) as first line of defense
    const authCheck = findInSource(source, /user\?.id/g);
    expect(authCheck.length).toBe(1);
  });

  it("should confirm VoidConfirmDialog has NO permission guard", async () => {
    const source = await readSourceFile(VOID_CONFIRM_DIALOG);

    // No permission check in the dialog component
    const permCheck = findInSource(
      source,
      /usePermissions|hasPermission|PermissionGuard|canVoid|isAdmin/gi
    );
    expect(permCheck.length).toBe(0);

    // The dialog is a simple UI confirmation with a reason textarea
    // Any user who can see the void button can void any document
    const reasonInput = findInSource(source, /Textarea/g);
    expect(reasonInput.length).toBeGreaterThan(0);
  });

  it("should confirm DocumentHistoryView shows void button without role check", async () => {
    const source = await readSourceFile(DOCUMENT_HISTORY);

    // Uses useVoidDocument hook
    const voidHook = findInSource(source, /useVoidDocument/g);
    expect(voidHook.length).toBeGreaterThan(0);

    // No permission check gates the void button visibility
    const permCheck = findInSource(
      source,
      /usePermissions|hasPermission|canVoid|isAdmin|isManager/gi
    );
    expect(permCheck.length).toBe(0);
  });

  it("should confirm void creates an audit trail (positive) but no admin approval required", async () => {
    const source = await readSourceFile(VOID_RPC_MIGRATION);

    // Positive: void creates inverse events (audit trail)
    const inverseEvents = findInSource(source, /INSERT INTO stock_events/g);
    expect(inverseEvents.length).toBeGreaterThan(0);

    // Positive: void marks original document as VOID status
    const voidStatus = findInSource(source, /SET status = 'VOID'/g);
    expect(voidStatus.length).toBe(1);

    // Positive: void records who voided and when
    const voidedBy = findInSource(source, /voided_by = p_voided_by/g);
    expect(voidedBy.length).toBe(1);

    // Negative: no approval workflow or admin check
    const approvalCheck = findInSource(source, /approval|admin_approve|require_admin|elevated/gi);
    expect(approvalCheck.length).toBe(0);
  });
});
