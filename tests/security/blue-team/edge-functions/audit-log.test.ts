/**
 * DATA-01: Audit Log Assessment
 *
 * Verifies that audit logging exists for sensitive operations.
 * An audit trail is critical for:
 *   - RGPD compliance (tracking who accessed what personal data)
 *   - Security incident investigation
 *   - Accountability for admin actions
 *
 * Checks for:
 *   - audit_logs table exists in migrations
 *   - audit_logs table has proper schema (org, user, action, target)
 *   - RLS is enabled on audit_logs
 *   - Sensitive data access (IBAN/SSN decrypt) triggers audit log
 *   - Employee mutations are audit-logged
 *   - Data retention cleanup logs its actions
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, globSourceFiles } from "../../helpers";

describe("DATA-01: Audit Log Assessment", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. audit_logs table exists in migrations
  // ═══════════════════════════════════════════════════════════════════════

  it("audit_logs table should be created in migrations", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260110130155_d109640d-598e-4763-977f-a3f5f10da94f.sql"
    );
    expect(content).toContain("CREATE TABLE public.audit_logs");
  });

  it("audit_logs table should have required columns", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260110130155_d109640d-598e-4763-977f-a3f5f10da94f.sql"
    );
    // Required columns for a proper audit trail
    expect(content).toContain("organization_id");
    expect(content).toContain("user_id");
    expect(content).toContain("action");
    expect(content).toContain("target_type");
    expect(content).toContain("target_id");
    expect(content).toContain("metadata");
    expect(content).toContain("created_at");
  });

  it("audit_logs table should have RLS enabled", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260110130155_d109640d-598e-4763-977f-a3f5f10da94f.sql"
    );
    expect(content).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("audit_logs table should have admin-only RLS policy", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260110130155_d109640d-598e-4763-977f-a3f5f10da94f.sql"
    );
    expect(content).toContain("is_admin");
    // Should only be readable by admins
    const hasAdminPolicy =
      content.includes("Admins can view org audit logs") || content.includes("admin");
    expect(hasAdminPolicy).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Sensitive data access (IBAN/SSN decrypt) triggers audit log
  // ═══════════════════════════════════════════════════════════════════════

  it("employees function should log audit entry when decrypting IBAN/SSN", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    // Should have audit logging for sensitive data reads
    expect(content).toContain("sensitive_data_read");
    // Should reference the fields being accessed
    expect(content).toContain("fields_accessed");
  });

  it("employees function should log which sensitive fields were accessed", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    // Should specifically track IBAN and SSN access
    const tracksIban = content.includes('"iban"');
    const tracksSsn = content.includes('"ssn"');
    expect(tracksIban).toBe(true);
    expect(tracksSsn).toBe(true);
  });

  it("audit logging for sensitive data should only trigger when data actually exists", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    // Should check if IBAN/SSN exists before logging
    const checksExistence =
      content.includes("hasIban") ||
      content.includes("hasSsn") ||
      content.includes("iban_encrypted") ||
      content.includes("ssn_encrypted");
    expect(checksExistence).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Employee mutations are audit-logged
  // ═══════════════════════════════════════════════════════════════════════

  it("employees function should log employee detail updates", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    expect(content).toContain("employee_details_updated");
  });

  it("employees function should log contract end (suspension)", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    expect(content).toContain("employee_contract_ended");
  });

  it("employees function should log employee reactivation", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    expect(content).toContain("employee_reactivated");
  });

  it("employees function should log hard delete (RGPD erasure)", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    expect(content).toContain("employee_hard_deleted");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Audit log entries include necessary context
  // ═══════════════════════════════════════════════════════════════════════

  it("employees function should have a logAudit helper that inserts into audit_logs", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    // Should have a helper function that wraps audit_logs inserts
    expect(content).toContain("logAudit");
    expect(content).toContain("audit_logs");
  });

  it("audit log entries should include organization_id for scoping", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    // The logAudit function should include organization_id
    const logAuditBlock = content.substring(
      content.indexOf("async function logAudit"),
      content.indexOf("async function logAudit") + 500
    );
    expect(logAuditBlock).toContain("organization_id");
  });

  it("audit log entries should include the acting user_id", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    const logAuditBlock = content.substring(
      content.indexOf("async function logAudit"),
      content.indexOf("async function logAudit") + 500
    );
    expect(logAuditBlock).toContain("user_id");
  });

  it("hard delete audit should NOT include deleted personal data (RGPD compliant)", async () => {
    const content = await readSourceFile("supabase/functions/employees/index.ts");
    // Find the hard_delete audit log call
    const hardDeleteSection = content.substring(
      content.indexOf("employee_hard_deleted"),
      content.indexOf("employee_hard_deleted") + 500
    );
    // Should use hashed/masked email, not the actual email
    expect(hardDeleteSection).toContain("email_hash");
    // Should include deletion summary (what was deleted, not what it contained)
    expect(hardDeleteSection).toContain("deletion_summary");
    // Should NOT include the actual email address
    expect(hardDeleteSection).not.toContain("email: targetProfile.email,");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Data retention cleanup logs its actions
  // ═══════════════════════════════════════════════════════════════════════

  it("data-retention-cleanup should log cleanup actions to audit_logs", async () => {
    const content = await readSourceFile("supabase/functions/data-retention-cleanup/index.ts");
    expect(content).toContain("audit_logs");
    expect(content).toContain("data_retention_cleanup");
  });

  it("data-retention-cleanup should log results summary", async () => {
    const content = await readSourceFile("supabase/functions/data-retention-cleanup/index.ts");
    expect(content).toContain("results");
    expect(content).toContain("total_actions");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Document audit logging coverage across all edge functions
  // ═══════════════════════════════════════════════════════════════════════

  it("should document which edge functions use audit logging", async () => {
    const edgeFunctions = await globSourceFiles("supabase/functions/*/index.ts");
    const withAuditLog: string[] = [];
    const withoutAuditLog: string[] = [];

    for (const file of edgeFunctions) {
      const content = await readSourceFile(file);
      const functionName = file.replace(/.*supabase\/functions\//, "").replace(/\/index\.ts$/, "");

      const usesAuditLog = content.includes("audit_logs") || content.includes("logAudit");

      if (usesAuditLog) {
        withAuditLog.push(functionName);
      } else {
        withoutAuditLog.push(functionName);
      }
    }

    console.log(`[DATA-01] Functions WITH audit logging (${withAuditLog.length}):`, withAuditLog);
    console.log(
      `[DATA-01] Functions WITHOUT audit logging (${withoutAuditLog.length}):`,
      withoutAuditLog
    );

    // At minimum, employees and data-retention-cleanup should log
    expect(withAuditLog).toContain("employees");
    expect(withAuditLog).toContain("data-retention-cleanup");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Verify audit log schema supports extensibility
  // ═══════════════════════════════════════════════════════════════════════

  it("audit_logs table should have jsonb metadata column for flexible data", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260110130155_d109640d-598e-4763-977f-a3f5f10da94f.sql"
    );
    expect(content).toContain("metadata jsonb");
  });

  it("audit_logs table should auto-timestamp with created_at", async () => {
    const content = await readSourceFile(
      "supabase/migrations/20260110130155_d109640d-598e-4763-977f-a3f5f10da94f.sql"
    );
    expect(content).toContain("created_at");
    expect(content).toContain("DEFAULT now()");
  });
});
