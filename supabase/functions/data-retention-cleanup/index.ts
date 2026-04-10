import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";
import { extractClientContext } from "../_shared/deleteHelpers.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");
const log = createLogger("data-retention-cleanup");

/**
 * RGPD-05: Automatic Data Retention Cleanup
 *
 * This edge function enforces data retention periods as defined in
 * docs/data-retention-policy.md. It should be invoked periodically
 * (e.g., weekly via Supabase Cron or external scheduler).
 *
 * Retention periods (from French labour law & RGPD):
 *   - Badge events:          5 years (Art. L3245-1 Code du travail)
 *   - Payroll records:       5 years post-departure (Art. L3243-4)
 *   - Employee data:         contract_end + 5 years -> anonymize (Art. 2224 Code civil)
 *   - Planning shifts:       2 years (current + previous year)
 *   - Leave records:         contract_end + 3 years (Art. L3245-1)
 *   - Invoices:              10 years (Art. L123-22 Code de commerce)
 *   - Audit logs:            2 years (internal policy)
 *
 * Actions:
 *   - Anonymize personal data (replace names, emails with "[ANONYMISE]")
 *   - Delete truly expired records
 *   - Log all actions to audit_logs
 *   - Return summary of actions taken
 *
 * Security:
 *   - Requires admin authentication (not a public endpoint)
 *   - Uses service role for mutations
 *   - All deletions are logged for RGPD compliance
 */

interface CleanupResult {
  category: string;
  action: "anonymized" | "deleted";
  count: number;
  details?: string;
}

Deno.serve(async (req) => {
  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    log.info("Request received");

    // 2. Auth check (require admin)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      log.warn("Missing or invalid authorization header");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      log.warn("auth_failed", { reason: "invalid_token" });
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const currentUserId = claimsData.user.id;

    // 3. DB-ADMIN-001: Prefer has_module_access (V2 RBAC) with is_admin fallback
    let hasAdminAccess = false;
    const { data: userEstabs } = await supabaseUser
      .from("user_establishments")
      .select("establishment_id")
      .eq("user_id", currentUserId)
      .limit(1);

    if (userEstabs && userEstabs.length > 0) {
      const { data: hasAccess } = await supabaseUser.rpc("has_module_access", {
        _module_key: "admin",
        _min_level: "write",
        _establishment_id: userEstabs[0].establishment_id,
      });
      hasAdminAccess = !!hasAccess;
    }

    // Fallback to legacy is_admin check
    if (!hasAdminAccess) {
      const { data: isAdmin, error: adminCheckError } = await supabaseUser.rpc("is_admin", {
        _user_id: currentUserId,
      });
      hasAdminAccess = !adminCheckError && !!isAdmin;
    }

    if (!hasAdminAccess) {
      log.warn("Admin check failed", { user_id: currentUserId });
      return new Response(
        JSON.stringify({ error: "Forbidden: Admin access required" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Get organization ID
    const { data: orgId, error: orgError } = await supabaseUser.rpc("get_user_organization_id");
    if (orgError || !orgId) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // 4. Admin client for mutations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limiting (P0-5)
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 5, keyPrefix: "data-retention-cleanup" });
    if (rateLimited) return rateLimited;

    // Parse optional body for dry_run mode
    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = body?.dry_run === true;
    } catch {
      // No body or invalid JSON — proceed with actual cleanup
    }

    const results: CleanupResult[] = [];
    const now = new Date();

    // Client context for audit logging (DATA-01 + SEC-DATA-031)
    const { ip: clientIp, userAgent: clientUserAgent } = extractClientContext(req);

    // Audit logging helper
    async function logAudit(actionName: string, metadata: Record<string, unknown>) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: orgId,
        user_id: currentUserId,
        action: actionName,
        target_type: "data_retention",
        target_id: null,
        metadata: { ...metadata, dry_run: dryRun },
        ip_address: clientIp,
        user_agent: clientUserAgent,
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // Category 1: Badge events older than 5 years — DELETE
    // (Art. L3245-1 Code du travail)
    // ═══════════════════════════════════════════════════════════════
    const badgeCutoff = new Date(now);
    badgeCutoff.setFullYear(badgeCutoff.getFullYear() - 5);

    const { count: badgeExpiredCount } = await supabaseAdmin
      .from("badge_events")
      .select("id", { count: "exact", head: true })
      .lt("created_at", badgeCutoff.toISOString());

    if (badgeExpiredCount && badgeExpiredCount > 0) {
      if (!dryRun) {
        await supabaseAdmin
          .from("badge_events")
          .delete()
          .lt("created_at", badgeCutoff.toISOString());
      }
      results.push({
        category: "badge_events",
        action: "deleted",
        count: badgeExpiredCount,
        details: `Records older than ${badgeCutoff.toISOString().split("T")[0]}`,
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // Category 2: Planning shifts older than 2 years — DELETE
    // (No legal requirement, operational data)
    // ═══════════════════════════════════════════════════════════════
    const planningCutoff = new Date(now);
    planningCutoff.setFullYear(planningCutoff.getFullYear() - 2);

    const { count: planningExpiredCount } = await supabaseAdmin
      .from("planning_shifts")
      .select("id", { count: "exact", head: true })
      .lt("created_at", planningCutoff.toISOString());

    if (planningExpiredCount && planningExpiredCount > 0) {
      if (!dryRun) {
        await supabaseAdmin
          .from("planning_shifts")
          .delete()
          .lt("created_at", planningCutoff.toISOString());
      }
      results.push({
        category: "planning_shifts",
        action: "deleted",
        count: planningExpiredCount,
        details: `Records older than ${planningCutoff.toISOString().split("T")[0]}`,
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // Category 3: Audit logs older than 2 years — DELETE
    // (Internal policy)
    // ═══════════════════════════════════════════════════════════════
    const auditCutoff = new Date(now);
    auditCutoff.setFullYear(auditCutoff.getFullYear() - 2);

    const { count: auditExpiredCount } = await supabaseAdmin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .lt("created_at", auditCutoff.toISOString());

    if (auditExpiredCount && auditExpiredCount > 0) {
      if (!dryRun) {
        await supabaseAdmin
          .from("audit_logs")
          .delete()
          .lt("created_at", auditCutoff.toISOString());
      }
      results.push({
        category: "audit_logs",
        action: "deleted",
        count: auditExpiredCount,
        details: `Records older than ${auditCutoff.toISOString().split("T")[0]}`,
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // Category 4: Expired employee data — ANONYMIZE
    // Employees whose contract ended > 5 years ago
    // (Art. 2224 Code civil — 5-year prescription)
    // Anonymize personal data, delete encrypted fields
    // ═══════════════════════════════════════════════════════════════
    const employeeCutoff = new Date(now);
    employeeCutoff.setFullYear(employeeCutoff.getFullYear() - 5);
    const employeeCutoffDate = employeeCutoff.toISOString().split("T")[0]; // YYYY-MM-DD

    // Find employee_details with contract_end_date older than 5 years
    const { data: expiredEmployees } = await supabaseAdmin
      .from("employee_details")
      .select("user_id, contract_end_date")
      .not("contract_end_date", "is", null)
      .lt("contract_end_date", employeeCutoffDate);

    if (expiredEmployees && expiredEmployees.length > 0) {
      let anonymizedCount = 0;

      for (const emp of expiredEmployees) {
        // Check if already anonymized (profile already has [ANONYMISE] name)
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("user_id", emp.user_id)
          .maybeSingle();

        if (profile && profile.full_name === "[ANONYMISE]") {
          continue; // Already anonymized
        }

        if (!dryRun) {
          // Anonymize profile
          await supabaseAdmin
            .from("profiles")
            .update({
              full_name: "[ANONYMISE]",
              second_first_name: null,
              email: `anonymised-${emp.user_id.substring(0, 8)}@deleted.local`,
              status: "disabled",
            })
            .eq("user_id", emp.user_id);

          // Anonymize employee_details: clear all PII, keep contract metadata
          await supabaseAdmin
            .from("employee_details")
            .update({
              phone: null,
              address: null,
              iban: null,
              iban_encrypted: null,
              iban_last4: null,
              social_security_number: null,
              ssn_encrypted: null,
              ssn_last2: null,
              id_type: null,
              id_issue_date: null,
              id_expiry_date: null,
              navigo_pass_number: null,
              has_navigo_pass: false,
            })
            .eq("user_id", emp.user_id);

          // Delete associated Storage files
          const { data: docRows } = await supabaseAdmin
            .from("employee_documents")
            .select("storage_path")
            .eq("user_id", emp.user_id);

          if (docRows && docRows.length > 0) {
            const paths = docRows.map((d: { storage_path: string }) => d.storage_path).filter(Boolean);
            if (paths.length > 0) {
              await supabaseAdmin.storage.from("employee-documents").remove(paths);
            }
            // Delete document records
            await supabaseAdmin
              .from("employee_documents")
              .delete()
              .eq("user_id", emp.user_id);
          }
        }

        anonymizedCount++;
      }

      if (anonymizedCount > 0) {
        results.push({
          category: "employees",
          action: "anonymized",
          count: anonymizedCount,
          details: `Employees with contract ended before ${employeeCutoffDate}`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Category 5: Leave records for expired employees — DELETE
    // Employees whose contract ended > 3 years ago (for leaves)
    // (Art. L3245-1 Code du travail — 3-year prescription for leave disputes)
    // ═══════════════════════════════════════════════════════════════
    const leaveCutoff = new Date(now);
    leaveCutoff.setFullYear(leaveCutoff.getFullYear() - 3);
    const leaveCutoffDate = leaveCutoff.toISOString().split("T")[0];

    // Find employees whose contract ended > 3 years ago
    const { data: leaveExpiredEmployees } = await supabaseAdmin
      .from("employee_details")
      .select("user_id")
      .not("contract_end_date", "is", null)
      .lt("contract_end_date", leaveCutoffDate);

    if (leaveExpiredEmployees && leaveExpiredEmployees.length > 0) {
      const expiredUserIds = leaveExpiredEmployees.map((e: { user_id: string }) => e.user_id);
      let totalLeavesDeleted = 0;
      let totalLeaveRequestsDeleted = 0;

      // Process in batches (Supabase .in() has practical limits)
      const batchSize = 50;
      for (let i = 0; i < expiredUserIds.length; i += batchSize) {
        const batch = expiredUserIds.slice(i, i + batchSize);

        const { count: leavesCount } = await supabaseAdmin
          .from("personnel_leaves")
          .select("id", { count: "exact", head: true })
          .in("user_id", batch);

        if (leavesCount && leavesCount > 0) {
          if (!dryRun) {
            await supabaseAdmin
              .from("personnel_leaves")
              .delete()
              .in("user_id", batch);
          }
          totalLeavesDeleted += leavesCount;
        }

        const { count: leaveReqCount } = await supabaseAdmin
          .from("personnel_leave_requests")
          .select("id", { count: "exact", head: true })
          .in("user_id", batch);

        if (leaveReqCount && leaveReqCount > 0) {
          if (!dryRun) {
            await supabaseAdmin
              .from("personnel_leave_requests")
              .delete()
              .in("user_id", batch);
          }
          totalLeaveRequestsDeleted += leaveReqCount;
        }
      }

      if (totalLeavesDeleted > 0) {
        results.push({
          category: "personnel_leaves",
          action: "deleted",
          count: totalLeavesDeleted,
          details: `Leaves for employees with contract ended before ${leaveCutoffDate}`,
        });
      }
      if (totalLeaveRequestsDeleted > 0) {
        results.push({
          category: "personnel_leave_requests",
          action: "deleted",
          count: totalLeaveRequestsDeleted,
          details: `Leave requests for employees with contract ended before ${leaveCutoffDate}`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Category 6: Badge PIN failures older than 30 days — DELETE
    // (Operational security data, no legal retention requirement)
    // ═══════════════════════════════════════════════════════════════
    const pinFailCutoff = new Date(now);
    pinFailCutoff.setDate(pinFailCutoff.getDate() - 30);

    const { count: pinFailExpiredCount } = await supabaseAdmin
      .from("badge_pin_failures")
      .select("id", { count: "exact", head: true })
      .lt("attempted_at", pinFailCutoff.toISOString());

    if (pinFailExpiredCount && pinFailExpiredCount > 0) {
      if (!dryRun) {
        await supabaseAdmin
          .from("badge_pin_failures")
          .delete()
          .lt("attempted_at", pinFailCutoff.toISOString());
      }
      results.push({
        category: "badge_pin_failures",
        action: "deleted",
        count: pinFailExpiredCount,
        details: `Records older than ${pinFailCutoff.toISOString().split("T")[0]}`,
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // Category 7: Expired invitation tokens — UPDATE status
    // (Security: tokens older than 7 days should not be valid)
    // ═══════════════════════════════════════════════════════════════
    const invitationCutoff = new Date(now);
    invitationCutoff.setDate(invitationCutoff.getDate() - 7);

    const { count: expiredInvCount } = await supabaseAdmin
      .from("invitations")
      .select("id", { count: "exact", head: true })
      .eq("status", "invited")
      .lt("created_at", invitationCutoff.toISOString());

    if (expiredInvCount && expiredInvCount > 0) {
      if (!dryRun) {
        await supabaseAdmin
          .from("invitations")
          .update({ status: "expired" })
          .eq("status", "invited")
          .lt("created_at", invitationCutoff.toISOString());
      }
      results.push({
        category: "invitations",
        action: "deleted",
        count: expiredInvCount,
        details: `Expired invitations older than 7 days`,
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // Log the cleanup run
    // ═══════════════════════════════════════════════════════════════
    await logAudit("data_retention_cleanup", {
      results,
      total_actions: results.reduce((sum, r) => sum + r.count, 0),
      executed_at: now.toISOString(),
    });

    const totalAffected = results.reduce((sum, r) => sum + r.count, 0);
    log.info("Cleanup completed", { dry_run: dryRun, total_affected: totalAffected, categories: results.length });

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        executed_at: now.toISOString(),
        results,
        total_affected: totalAffected,
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (error) {
    log.error("Cleanup failed", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
