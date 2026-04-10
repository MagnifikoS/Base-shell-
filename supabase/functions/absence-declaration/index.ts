/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EDGE FUNCTION: absence-declaration
 * Module: Congés & Absences (Phase 2 - Workflow Demandes)
 * 
 * Actions:
 *   - declare_leave_request: Create pending request (salarié read/self)
 *   - list_my_leave_requests: List current user's requests
 *   - list_leave_requests: List requests for manager (scope-based)
 *   - review_leave_requests: Approve/reject requests (manager write)
 *   - list_my_absences: (legacy) List approved absences
 *   - upload_justificatif: Upload justificatif and link to request or leave
 * 
 * SSOT: personnel_leaves (approved) = planning source of truth
 * Workflow: personnel_leave_requests (pending/approved/rejected)
 * Validation: calls planning-week/mark_leave (unique write path)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");

function jsonOk<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function jsonErr(error: string, status = 400, code?: string, payload?: Record<string, unknown>): Response {
  const body: Record<string, unknown> = { error };
  if (code) body.code = code;
  if (payload) Object.assign(body, payload);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

type AnyClient = ReturnType<typeof createClient>;

// ═══════════════════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + "T12:00:00Z");
  const end = new Date(endDate + "T12:00:00Z");
  
  const current = new Date(start);
  while (current <= end) {
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, "0");
    const d = String(current.getUTCDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  
  return dates;
}

function getMonthStart(monthsBack: number): string {
  const now = new Date();
  now.setUTCMonth(now.getUTCMonth() - monthsBack);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: declare_leave_request (salarié read/self)
// Creates pending request(s) in personnel_leave_requests
// Does NOT write to personnel_leaves or touch planning
// ═══════════════════════════════════════════════════════════════════════════

interface DeclareLeaveRequestBody {
  action: "declare_leave_request";
  establishment_id: string;
  leave_type: "absence" | "cp" | "am";
  date_start: string;
  date_end: string;
  reason?: string;
}

async function handleDeclareLeaveRequest(
  body: DeclareLeaveRequestBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<Response> {
  const { establishment_id, leave_type, date_start, date_end, reason } = body;

  // Validate required fields
  if (!establishment_id || !leave_type || !date_start || !date_end) {
    return jsonErr("Missing required fields", 400);
  }

  // Validate leave_type
  if (leave_type !== "absence" && leave_type !== "cp" && leave_type !== "am") {
    return jsonErr("leave_type must be 'absence', 'cp' or 'am'", 400);
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date_start) || !dateRegex.test(date_end)) {
    return jsonErr("Invalid date format. Use YYYY-MM-DD", 400);
  }

  // Validate date_end >= date_start
  if (date_end < date_start) {
    return jsonErr("date_end must be >= date_start", 400);
  }

  // RBAC: conges_absences:read (scope self enforced by RLS + user_id = auth.uid())
  const { data: hasAccess, error: accessError } = await userClient.rpc("has_module_access", {
    _module_key: "conges_absences",
    _min_level: "read",
    _establishment_id: establishment_id,
  });

  if (accessError) {
    log.error("RBAC check error", accessError);
    return jsonErr("Permission check failed", 500);
  }

  if (!hasAccess) {
    return jsonErr("Accès refusé: permission conges_absences:read requise", 403);
  }

  // Generate date range
  const dates = generateDateRange(date_start, date_end);

  // ═══════════════════════════════════════════════════════════════════════════
  // PRE-CHECK: Conflicts (approved + pending)
  // If any conflict → return 409 LEAVE_CONFLICT, do NOT insert anything
  // ═══════════════════════════════════════════════════════════════════════════

  // Check approved absences in personnel_leaves
  const { data: approvedConflicts, error: approvedErr } = await adminClient
    .from("personnel_leaves")
    .select("leave_date")
    .eq("establishment_id", establishment_id)
    .eq("user_id", userId)
    .eq("status", "approved")
    .in("leave_date", dates);

  if (approvedErr) {
    log.error("Check approved error", approvedErr);
    return jsonErr("Failed to check existing absences", 500);
  }

  // Check pending requests in personnel_leave_requests
  const { data: pendingConflicts, error: pendingErr } = await adminClient
    .from("personnel_leave_requests")
    .select("leave_date")
    .eq("establishment_id", establishment_id)
    .eq("user_id", userId)
    .eq("status", "pending")
    .in("leave_date", dates);

  if (pendingErr) {
    log.error("Check pending error", pendingErr);
    return jsonErr("Failed to check existing requests", 500);
  }

  const conflictsApproved = (approvedConflicts || []).map((l) => l.leave_date).sort();
  const conflictsPending = (pendingConflicts || []).map((l) => l.leave_date).sort();

  if (conflictsApproved.length > 0 || conflictsPending.length > 0) {
    log.warn("leave_conflict", { user_id: userId, approved: conflictsApproved, pending: conflictsPending });
    
    let message = "";
    if (conflictsApproved.length > 0) {
      message += `Dates déjà validées : ${conflictsApproved.join(", ")}. `;
    }
    if (conflictsPending.length > 0) {
      message += `Dates déjà demandées : ${conflictsPending.join(", ")}.`;
    }
    
    return jsonErr(
      message.trim(),
      409,
      "LEAVE_CONFLICT",
      { conflicts_approved: conflictsApproved, conflicts_pending: conflictsPending }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INSERT: Create pending request for each date
  // RLS handles INSERT permission (user_id = auth.uid() + conges_absences:read)
  // ═══════════════════════════════════════════════════════════════════════════

  const requestsToInsert = dates.map((leaveDate) => ({
    establishment_id,
    user_id: userId,
    leave_date: leaveDate,
    leave_type,
    reason: reason || null,
    status: "pending",
  }));

  const { error: insertError } = await adminClient
    .from("personnel_leave_requests")
    .insert(requestsToInsert);

  if (insertError) {
    log.error("Insert requests error", insertError);
    // Check for unique constraint violation (race condition)
    if (insertError.code === "23505") {
      return jsonErr("Une demande existe déjà pour certaines dates", 409, "LEAVE_CONFLICT");
    }
    return jsonErr("Failed to create leave request", 500);
  }

  log.info("completed", { action: "declare_leave_request", user_id: userId, days_count: dates.length });

  return jsonOk({
    success: true,
    dates,
    message: `Demande créée pour ${dates.length} jour(s)`,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: list_my_leave_requests (salarié)
// ═══════════════════════════════════════════════════════════════════════════

interface ListMyLeaveRequestsBody {
  action: "list_my_leave_requests";
  establishment_id: string;
  months_back?: number;
}

async function handleListMyLeaveRequests(
  body: ListMyLeaveRequestsBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<Response> {
  const { establishment_id } = body;
  const months_back = Math.min(Math.max(Number(body.months_back) || 6, 1), 24);

  if (!establishment_id) {
    return jsonErr("Missing establishment_id", 400);
  }

  // RBAC check
  const { data: hasAccess, error: accessError } = await userClient.rpc("has_module_access", {
    _module_key: "conges_absences",
    _min_level: "read",
    _establishment_id: establishment_id,
  });

  if (accessError || !hasAccess) {
    return jsonErr("Accès refusé", 403);
  }

  const startDate = getMonthStart(months_back);

  const { data: requests, error } = await adminClient
    .from("personnel_leave_requests")
    .select("id, leave_date, leave_type, reason, status, reviewed_by, reviewed_at, created_at")
    .eq("establishment_id", establishment_id)
    .eq("user_id", userId)
    .gte("leave_date", startDate)
    .order("leave_date", { ascending: false });

  if (error) {
    log.error("List my requests error", error);
    return jsonErr("Failed to fetch requests", 500);
  }

  return jsonOk({ requests: requests || [] });
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: list_leave_requests (manager scope)
// ═══════════════════════════════════════════════════════════════════════════

interface ListLeaveRequestsBody {
  action: "list_leave_requests";
  establishment_id: string;
  year_month?: string; // YYYY-MM, defaults to current month
  status_filter?: "pending" | "all";
}

async function handleListLeaveRequests(
  body: ListLeaveRequestsBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<Response> {
  const { establishment_id, year_month, status_filter = "pending" } = body;

  if (!establishment_id) {
    return jsonErr("Missing establishment_id", 400);
  }

  // RBAC: conges_absences:write required for manager view
  const { data: hasAccess, error: accessError } = await userClient.rpc("has_module_access", {
    _module_key: "conges_absences",
    _min_level: "write",
    _establishment_id: establishment_id,
  });

  if (accessError || !hasAccess) {
    return jsonErr("Accès refusé: permission conges_absences:write requise", 403);
  }

  // =====================================================
  // PER-MGR-014: TEAM-SCOPE FILTERING
  // If manager has scope=team, only return requests from
  // employees in the manager's teams.
  // =====================================================
  let allowedUserIds: string[] | null = null; // null = no filter

  const { data: permsData } = await userClient.rpc("get_my_permissions_v2", {
    _establishment_id: establishment_id,
  });

  if (permsData) {
    const caPerm = (permsData.permissions || []).find(
      (p: { module_key: string }) => p.module_key === "conges_absences"
    );
    const scope = caPerm?.scope ?? "self";
    const managerTeamIds: string[] = permsData.team_ids ?? [];

    if (scope === "team") {
      if (managerTeamIds.length === 0) {
        return jsonOk({ requests: [] });
      }
      const { data: teamUsers } = await adminClient
        .from("user_teams")
        .select("user_id")
        .in("team_id", managerTeamIds);
      allowedUserIds = [...new Set((teamUsers || []).map((tu: { user_id: string }) => tu.user_id))];
      if (allowedUserIds.length === 0) {
        return jsonOk({ requests: [] });
      }
    } else if (scope === "self") {
      allowedUserIds = [userId];
    }
    // establishment / org: no filter (allowedUserIds stays null)
  }

  // Build query
  let query = adminClient
    .from("personnel_leave_requests")
    .select(`
      id,
      user_id,
      leave_date,
      leave_type,
      reason,
      status,
      reviewed_by,
      reviewed_at,
      created_at
    `)
    .eq("establishment_id", establishment_id);

  // Apply team-scope user filter
  if (allowedUserIds !== null) {
    query = query.in("user_id", allowedUserIds);
  }

  // If year_month is provided, filter by month; otherwise show all (for pending view)
  if (year_month) {
    const [year, month] = year_month.split("-").map(Number);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    // Compute the actual last day of the month (handles Feb, 30-day months, etc.)
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    query = query.gte("leave_date", startDate).lte("leave_date", endDate);
  }

  if (status_filter === "pending") {
    query = query.eq("status", "pending");
  }

  query = query.order("leave_date", { ascending: true });

  const { data: requests, error } = await query;

  if (error) {
    log.error("List requests error", error);
    return jsonErr("Failed to fetch requests", 500);
  }

  // Enrich with user names
  const userIds = [...new Set((requests || []).map((r) => r.user_id))];
  
  let profiles: Array<{ user_id: string; full_name: string | null }> = [];
  if (userIds.length > 0) {
    const { data: profilesData } = await adminClient
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);
    profiles = profilesData || [];
  }

  const profileMap = new Map(profiles.map((p) => [p.user_id, p.full_name || "Inconnu"]));

  const enrichedRequests = (requests || []).map((req) => ({
    ...req,
    user_name: profileMap.get(req.user_id) || "Inconnu",
  }));

  return jsonOk({ requests: enrichedRequests });
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: review_leave_requests (approve/reject)
// approve → calls planning-week/mark_leave for each day (SSOT path)
// ═══════════════════════════════════════════════════════════════════════════

interface ReviewLeaveRequestsBody {
  action: "review_leave_requests";
  establishment_id: string;
  review_action: "approve" | "reject";
  request_ids: string[];
  comment?: string;
}

async function handleReviewLeaveRequests(
  body: ReviewLeaveRequestsBody,
  callerUserId: string,
  userClient: AnyClient,
  adminClient: AnyClient,
  authHeader: string
): Promise<Response> {
  const { establishment_id, review_action, request_ids, comment: _comment } = body;

  if (!establishment_id || !review_action || !request_ids?.length) {
    return jsonErr("Missing required fields", 400);
  }


  // Validate request_ids are UUIDs and limit array size
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!Array.isArray(request_ids) || request_ids.length > 100) {
    return jsonErr("request_ids must be an array of max 100 UUIDs", 400);
  }
  if (request_ids.some((id: string) => !UUID_RE.test(id))) {
    return jsonErr("All request_ids must be valid UUIDs", 400);
  }
  if (review_action !== "approve" && review_action !== "reject") {
    return jsonErr("review_action must be 'approve' or 'reject'", 400);
  }

  // RBAC: conges_absences:write required
  const { data: hasAccess, error: accessError } = await userClient.rpc("has_module_access", {
    _module_key: "conges_absences",
    _min_level: "write",
    _establishment_id: establishment_id,
  });

  if (accessError || !hasAccess) {
    return jsonErr("Accès refusé: permission conges_absences:write requise", 403);
  }

  // =====================================================
  // PER-MGR-015: TEAM-SCOPE ENFORCEMENT FOR REVIEW
  // If manager has scope=team, only allow reviewing requests
  // from employees in the manager's teams.
  // =====================================================
  let allowedUserIdsForReview: string[] | null = null; // null = no filter

  const { data: reviewPermsData } = await userClient.rpc("get_my_permissions_v2", {
    _establishment_id: establishment_id,
  });

  if (reviewPermsData) {
    const caPerm = (reviewPermsData.permissions || []).find(
      (p: { module_key: string }) => p.module_key === "conges_absences"
    );
    const reviewScope = caPerm?.scope ?? "self";
    const reviewTeamIds: string[] = reviewPermsData.team_ids ?? [];

    if (reviewScope === "team") {
      if (reviewTeamIds.length === 0) {
        return jsonErr("Aucune équipe assignée, impossible de valider des demandes", 403);
      }
      const { data: teamUsersData } = await adminClient
        .from("user_teams")
        .select("user_id")
        .in("team_id", reviewTeamIds);
      allowedUserIdsForReview = [...new Set((teamUsersData || []).map((tu: { user_id: string }) => tu.user_id))];
    } else if (reviewScope === "self") {
      return jsonErr("Accès refusé : validation des demandes non autorisée", 403);
    }
    // establishment / org: no filter
  }

  // Fetch pending requests
  const { data: requests, error: fetchError } = await adminClient
    .from("personnel_leave_requests")
    .select("id, user_id, leave_date, leave_type, reason")
    .eq("establishment_id", establishment_id)
    .eq("status", "pending")
    .in("id", request_ids);

  if (fetchError) {
    log.error("Fetch requests error", fetchError);
    return jsonErr("Failed to fetch requests", 500);
  }

  if (!requests || requests.length === 0) {
    return jsonErr("Aucune demande pending trouvée", 404);
  }

  // PER-MGR-015: Verify all requested employees are within team scope
  if (allowedUserIdsForReview !== null) {
    const allowedSet = new Set(allowedUserIdsForReview);
    const outOfScope = requests.filter((r) => !allowedSet.has(r.user_id));
    if (outOfScope.length > 0) {
      const outOfScopeUserIds = [...new Set(outOfScope.map((r) => r.user_id))];
      log.warn("team_scope_denied", { out_of_scope_user_ids: outOfScopeUserIds });
      return jsonErr("Accès refusé : certaines demandes concernent des employés hors de votre équipe", 403, "OUT_OF_TEAM_SCOPE");
    }
  }

  // Check if all requested IDs were found
  const foundIds = new Set(requests.map((r) => r.id));
  const missingIds = request_ids.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    return jsonErr(`Demandes non trouvées ou déjà traitées: ${missingIds.join(", ")}`, 404);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APPROVE: Pre-check for conflicts, then call mark_leave for each day
  // ═══════════════════════════════════════════════════════════════════════════
  if (review_action === "approve") {
    // Group by user_id for conflict check
    const datesByUser = new Map<string, string[]>();
    for (const req of requests) {
      const userDates = datesByUser.get(req.user_id) || [];
      userDates.push(req.leave_date);
      datesByUser.set(req.user_id, userDates);
    }

    // Check for conflicts in personnel_leaves (race condition protection)
    for (const [targetUserId, dates] of datesByUser) {
      const { data: conflicts, error: conflictErr } = await adminClient
        .from("personnel_leaves")
        .select("leave_date")
        .eq("establishment_id", establishment_id)
        .eq("user_id", targetUserId)
        .eq("status", "approved")
        .in("leave_date", dates);

      if (conflictErr) {
        log.error("Conflict check error", conflictErr);
        return jsonErr("Failed to check for conflicts", 500);
      }

      if (conflicts && conflicts.length > 0) {
        const conflictDates = conflicts.map((c) => c.leave_date).sort();
        return jsonErr(
          `Dates déjà validées pour ce salarié : ${conflictDates.join(", ")}`,
          409,
          "LEAVE_CONFLICT",
          { conflicts_approved: conflictDates, user_id: targetUserId }
        );
      }
    }

    // Call planning-week/mark_leave for each request (SSOT path)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const planningWeekUrl = `${supabaseUrl}/functions/v1/planning-week`;

    // Track created leaves to update reason afterwards
    const createdLeaves: Array<{ user_id: string; leave_date: string; reason: string | null }> = [];

    for (const req of requests) {
      const markLeaveBody = {
        action: "mark_leave",
        establishment_id,
        user_id: req.user_id,
        leave_date: req.leave_date,
        leave_type: req.leave_type,
      };

      let response: Response;
      try {
        response = await fetch(planningWeekUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify(markLeaveBody),
        });
      } catch (fetchErr) {
        log.error("mark_leave network error", fetchErr, { leave_date: req.leave_date });
        return jsonErr(
          `Erreur réseau lors de la validation du ${req.leave_date}`,
          502
        );
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        log.error("mark_leave failed", errorData, { status: response.status, leave_date: req.leave_date });
        return jsonErr(
          `Erreur lors de la validation du ${req.leave_date}: ${errorData.error || "Unknown error"}`,
          500
        );
      }

      // Track for reason update
      if (req.reason) {
        createdLeaves.push({
          user_id: req.user_id,
          leave_date: req.leave_date,
          reason: req.reason,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UPDATE REASON: mark_leave creates the leave but without reason
    // We update personnel_leaves with the reason from the request
    // ═══════════════════════════════════════════════════════════════════════════
    for (const leave of createdLeaves) {
      const { error: reasonError } = await adminClient
        .from("personnel_leaves")
        .update({ reason: leave.reason })
        .eq("establishment_id", establishment_id)
        .eq("user_id", leave.user_id)
        .eq("leave_date", leave.leave_date)
        .eq("status", "approved");

      if (reasonError) {
        log.warn("update_reason_failed", { leave_date: leave.leave_date, error: reasonError });
        // Non-blocking - leave is already created
      }
    }

    // Update requests to approved
    const { error: updateError } = await adminClient
      .from("personnel_leave_requests")
      .update({
        status: "approved",
        reviewed_by: callerUserId,
        reviewed_at: new Date().toISOString(),
      })
      .in("id", request_ids);

    if (updateError) {
      log.error("Update requests error", updateError);
      // Note: mark_leave already executed, so planning is updated
      // Request status update failed but absences are in planning
      return jsonErr("Absences validées mais erreur lors de la mise à jour des demandes", 500);
    }

    log.info("completed", { action: "approve", count: requests.length, caller_id: callerUserId });
    return jsonOk({ success: true, approved_count: requests.length });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REJECT: Simply update status
  // ═══════════════════════════════════════════════════════════════════════════
  const { error: rejectError } = await adminClient
    .from("personnel_leave_requests")
    .update({
      status: "rejected",
      reviewed_by: callerUserId,
      reviewed_at: new Date().toISOString(),
    })
    .in("id", request_ids);

  if (rejectError) {
    log.error("Reject requests error", rejectError);
    return jsonErr("Failed to reject requests", 500);
  }

  log.info("completed", { action: "reject", count: requests.length, caller_id: callerUserId });
  return jsonOk({ success: true, rejected_count: requests.length });
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: list_my_absences (legacy - approved absences from personnel_leaves)
// ═══════════════════════════════════════════════════════════════════════════

interface ListMyAbsencesBody {
  action: "list_my_absences";
  establishment_id: string;
  months_back?: number;
}

async function handleListMyAbsences(
  body: ListMyAbsencesBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<Response> {
  const { establishment_id } = body;
  const months_back = Math.min(Math.max(Number(body.months_back) || 6, 1), 24);

  if (!establishment_id) {
    return jsonErr("Missing establishment_id", 400);
  }

  const { data: hasAccess, error: accessError } = await userClient.rpc("has_module_access", {
    _module_key: "conges_absences",
    _min_level: "read",
    _establishment_id: establishment_id,
  });

  if (accessError || !hasAccess) {
    return jsonErr("Accès refusé", 403);
  }

  const startDate = getMonthStart(months_back);

  const { data: leaves, error } = await adminClient
    .from("personnel_leaves")
    .select("id, leave_date, leave_type, status, reason, justificatif_document_id, created_at")
    .eq("establishment_id", establishment_id)
    .eq("user_id", userId)
    .eq("leave_type", "absence")
    .eq("status", "approved")
    .gte("leave_date", startDate)
    .order("leave_date", { ascending: false });

  if (error) {
    log.error("Fetch leaves error", error);
    return jsonErr("Failed to fetch absences", 500);
  }

  const absences = (leaves || []).map((leave) => ({
    id: leave.id,
    leave_date: leave.leave_date,
    reason: leave.reason,
    has_justificatif: leave.justificatif_document_id !== null,
    created_at: leave.created_at,
  }));

  return jsonOk({ absences });
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: upload_justificatif
// ═══════════════════════════════════════════════════════════════════════════

interface UploadJustificatifBody {
  action: "upload_justificatif";
  establishment_id: string;
  leave_date: string;
  file_base64: string;
  file_name: string;
  file_type: string;
}

async function handleUploadJustificatif(
  body: UploadJustificatifBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<Response> {
  const { establishment_id, leave_date, file_base64, file_name, file_type } = body;

  if (!establishment_id || !leave_date || !file_base64 || !file_name || !file_type) {
    return jsonErr("Missing required fields", 400);
  }

  const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
  if (!allowedTypes.includes(file_type)) {
    return jsonErr("Invalid file type. Allowed: PDF, JPEG, PNG", 400);
  }

  const { data: hasAccess, error: accessError } = await userClient.rpc("has_module_access", {
    _module_key: "conges_absences",
    _min_level: "read",
    _establishment_id: establishment_id,
  });

  if (accessError || !hasAccess) {
    return jsonErr("Accès refusé", 403);
  }

  // Find the leave record (approved in personnel_leaves)
  const { data: leave, error: leaveError } = await adminClient
    .from("personnel_leaves")
    .select("id")
    .eq("establishment_id", establishment_id)
    .eq("user_id", userId)
    .eq("leave_date", leave_date)
    .eq("status", "approved")
    .maybeSingle();

  if (leaveError || !leave) {
    return jsonErr("Absence not found for this date", 404);
  }

  const { data: orgId, error: orgError } = await userClient.rpc("get_user_organization_id");
  if (orgError || !orgId) {
    return jsonErr("Organization not found", 400);
  }

  let fileBytes: Uint8Array;
  try {
    const binaryString = atob(file_base64);
    fileBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      fileBytes[i] = binaryString.charCodeAt(i);
    }
  } catch {
    return jsonErr("Invalid base64 file data", 400);
  }

  if (fileBytes.length > 5 * 1024 * 1024) {
    return jsonErr("File too large. Maximum 5MB", 400);
  }

  const timestamp = Date.now();
  const ext = file_name.split(".").pop() || "pdf";
  const storagePath = `${orgId}/${userId}/justificatifs/${leave_date}_${timestamp}.${ext}`;

  const { error: uploadError } = await adminClient.storage
    .from("employee-documents")
    .upload(storagePath, fileBytes, {
      contentType: file_type,
      upsert: false,
    });

  if (uploadError) {
    log.error("Upload error", uploadError);
    return jsonErr("Failed to upload file", 500);
  }

  const { data: docData, error: docError } = await adminClient
    .from("employee_documents")
    .insert({
      organization_id: orgId,
      user_id: userId,
      document_type: "absence_justificatif",
      file_name,
      file_type,
      file_size: fileBytes.length,
      storage_path: storagePath,
      created_by: userId,
    })
    .select("id")
    .single();

  if (docError) {
    log.error("Insert document error", docError);
    await adminClient.storage.from("employee-documents").remove([storagePath]);
    return jsonErr("Failed to save document record", 500);
  }

  const { error: updateError } = await adminClient
    .from("personnel_leaves")
    .update({
      justificatif_document_id: docData.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leave.id);

  if (updateError) {
    log.error("Update leave error", updateError);
    return jsonErr("Failed to link document to absence", 500);
  }

  return jsonOk({ success: true, document_id: docData.id });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

const log = createLogger("absence-declaration");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      log.warn("Missing authorization header");
      return jsonErr("Missing Authorization header", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      log.error("Missing environment variables", { supabaseUrl: !!supabaseUrl, serviceKey: !!supabaseServiceKey, anonKey: !!supabaseAnonKey });
      return jsonErr("Server configuration error", 500);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      log.warn("Auth failed");
      return jsonErr("Unauthorized", 401);
    }

    // Rate limit check (after auth, before business logic)
    const rateLimited = await checkRateLimit(req, adminClient, { max: 20, keyPrefix: "absence-declaration" });
    if (rateLimited) return rateLimited;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonErr("Invalid JSON body", 400);
    }
    const action = body.action;

    log.info("handle_request", { user_id: user.id, action, establishment_id: body.establishment_id });

    switch (action) {
      // New workflow actions
      case "declare_leave_request":
        return handleDeclareLeaveRequest(body, user.id, userClient, adminClient);

      case "list_my_leave_requests":
        return handleListMyLeaveRequests(body, user.id, userClient, adminClient);

      case "list_leave_requests":
        return handleListLeaveRequests(body, user.id, userClient, adminClient);

      case "review_leave_requests":
        return handleReviewLeaveRequests(body, user.id, userClient, adminClient, authHeader);

      // Legacy actions (still supported)
      case "list_my_absences":
        return handleListMyAbsences(body, user.id, userClient, adminClient);

      case "upload_justificatif":
        return handleUploadJustificatif(body, user.id, userClient, adminClient);

      // ═══════════════════════════════════════════════════════════════════════════
      // DEPRECATED: kept for backward compatibility. Use declare_leave_request instead.
      // Will be removed in future version.
      // ═══════════════════════════════════════════════════════════════════════════
      case "declare_absence": {
        console.warn("[DEPRECATED] declare_absence called, use declare_leave_request instead");
        // Transform to new format
        const transformed: DeclareLeaveRequestBody = {
          action: "declare_leave_request",
          establishment_id: body.establishment_id,
          leave_type: body.motif_type === "maladie" ? "am" : "absence",
          date_start: body.date_start,
          date_end: body.date_end,
          reason: body.motif_type === "maladie" ? "Maladie" : body.motif_detail,
        };
        return handleDeclareLeaveRequest(transformed, user.id, userClient, adminClient);
      }

      default:
        return jsonErr(`Unknown action: ${action}`, 400);
    }
  } catch (error) {
    log.error("Unhandled error", error);
    return jsonErr("Internal server error", 500);
  }
});
