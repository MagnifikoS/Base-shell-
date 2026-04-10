/**
 * RED-DATA :: DATA-01 — Audit Logging for Sensitive Data
 *
 * Target: supabase/functions/employees/index.ts
 *
 * Original vulnerability: Audit log entries did not capture IP address
 * or user-agent, and had no immutability constraints.
 *
 * REMEDIATION STATUS: PARTIALLY FIXED.
 * - IP address and user-agent tracking added to all edge functions
 * - Immutability triggers added to audit_logs table
 * - Update audit still does not track which sensitive fields changed
 * - Failed decryption attempts still only console.error (not audit-logged)
 *
 * These tests serve as REGRESSION GUARDS for the fixes and document remaining gaps.
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("DATA-01: Audit Logging for Sensitive Data (PARTIALLY REMEDIATED)", () => {
  const EMPLOYEES_FN = "supabase/functions/employees/index.ts";

  it("should confirm audit logging exists for decrypt in 'get' action (SEC-19 remediation)", async () => {
    const source = await readSourceFile(EMPLOYEES_FN);

    // SEC-19 added audit logging near decrypt — this is the remediation baseline
    const auditNearDecrypt = findInSource(source, /sensitive_data_read/g);
    expect(auditNearDecrypt.length).toBeGreaterThan(0);
  });

  it("should confirm 'update' action audit DOES record which sensitive fields were changed (FIXED)", async () => {
    const source = await readSourceFile(EMPLOYEES_FN);

    // Find the update action's logAudit call
    const updateAuditCalls = findInSource(source, /logAudit\(\s*["']employee_details_updated["']/g);
    expect(updateAuditCalls.length).toBeGreaterThan(0);

    // Verify field-level tracking for sensitive data updates
    const tracksSensitiveFieldChanges =
      /sensitive_fields_changed|sensitive_fields|fields_changed.*iban|fields_changed.*ssn/i.test(
        source
      );
    expect(tracksSensitiveFieldChanges).toBe(true);
  });

  it("should confirm audit log NOW records IP address and user-agent (REMEDIATED)", async () => {
    const source = await readSourceFile(EMPLOYEES_FN);

    // Fix is in place: IP address and user-agent are captured in audit calls
    const ipCapture = findInSource(source, /ip_address|x-forwarded-for|x-real-ip/gi);
    const userAgentCapture = findInSource(source, /user.agent|user_agent/gi);

    expect(ipCapture.length).toBeGreaterThan(0);
    expect(userAgentCapture.length).toBeGreaterThan(0);
  });

  it("should confirm failed decryption attempts are logged via structured logger, not audit-logged", async () => {
    const source = await readSourceFile(EMPLOYEES_FN);

    // SEC-LOG-001: Decryption failures now use structured logging (log.warn) instead of console.error
    const structuredLogInDecrypt = findInSource(source, /log\.warn\(.*decryption_failed/g);
    expect(structuredLogInDecrypt.length).toBeGreaterThan(0);

    const decryptMatch = source.match(/async function decrypt\(encrypted: string\)[\s\S]*?^}/m);
    expect(decryptMatch).not.toBeNull();

    const decryptBody = decryptMatch![0];
    const auditInDecrypt = /logAudit|audit_log/i.test(decryptBody);

    // Remaining gap: decrypt errors not audit-logged (only structured log)
    expect(auditInDecrypt).toBe(false);
  });

  it("should confirm audit_logs table NOW has immutability protection (REMEDIATED)", async () => {
    const migrationFiles = await globSourceFiles("supabase/migrations/*.sql");

    let hasImmutabilityTrigger = false;

    for (const file of migrationFiles) {
      const content = await readSourceFile(file);
      if (/audit_log_no_update|audit_log_immutable|prevent_audit_log_modification/i.test(content)) {
        hasImmutabilityTrigger = true;
        break;
      }
    }

    // Fix is in place: immutability triggers exist
    expect(hasImmutabilityTrigger).toBe(true);
  });
});
