/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Shared Hard Delete Helpers for Edge Functions (SEC-DATA-031)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Canonical patterns for GDPR-compliant hard deletion.
 * Every hard delete MUST be preceded by an audit log entry.
 *
 * Usage:
 *   import { auditBeforeDelete, batchDelete } from "../_shared/deleteHelpers.ts";
 *
 *   await auditBeforeDelete(adminClient, {
 *     organizationId, userId, table: "badge_events",
 *     filter: { column: "id", value: eventId },
 *     reason: "Admin badge event deletion",
 *     ip, userAgent,
 *   });
 *   await adminClient.from("badge_events").delete().eq("id", eventId);
 *
 * @see docs/data-deletion-policy.md
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface DeleteAuditParams {
  /** Organization owning the data (required for multi-tenant isolation) */
  organizationId: string;
  /** User performing the deletion */
  userId: string;
  /** Table being deleted from */
  table: string;
  /** Filter criteria describing what's being deleted */
  filter: Record<string, unknown>;
  /** Human-readable reason for deletion */
  reason: string;
  /** Number of rows being deleted (if known). Skipped from log if undefined. */
  count?: number;
  /** Client IP from x-forwarded-for (GDPR audit trail) */
  ip?: string | null;
  /** Client User-Agent (GDPR audit trail) */
  userAgent?: string | null;
  /** Additional metadata to store in audit log */
  extra?: Record<string, unknown>;
}

export interface BatchDeleteResult {
  table: string;
  deletedCount: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT BEFORE DELETE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log an audit entry BEFORE performing a hard delete.
 *
 * This is the canonical pre-deletion audit pattern. The audit log
 * captures what is about to be deleted, who is deleting it, and why.
 * Even if the subsequent delete fails, the intent is recorded.
 *
 * @returns The inserted audit log ID (for correlation), or null on failure.
 */
export async function auditBeforeDelete(
  adminClient: SupabaseClient,
  params: DeleteAuditParams,
): Promise<string | null> {
  const metadata: Record<string, unknown> = {
    table: params.table,
    filter: params.filter,
    reason: params.reason,
    ...(params.count !== undefined ? { count: params.count } : {}),
    ...(params.extra ?? {}),
  };

  const { data, error } = await adminClient.from("audit_logs").insert({
    organization_id: params.organizationId,
    user_id: params.userId,
    action: `hard_delete:${params.table}`,
    target_type: params.table,
    target_id: typeof params.filter === "object" && "id" in params.filter
      ? String(params.filter.id)
      : null,
    metadata,
    ip_address: params.ip ?? null,
    user_agent: params.userAgent ?? null,
  }).select("id").maybeSingle();

  if (error) {
    console.error(`[deleteHelpers] auditBeforeDelete failed for ${params.table}:`, error.message);
    return null;
  }

  return data?.id ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT CONTEXT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract client IP and user-agent from a Request for audit logging.
 */
export function extractClientContext(req: Request): { ip: string | null; userAgent: string | null } {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || null;
  const userAgent = req.headers.get("user-agent") || null;
  return { ip, userAgent };
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH DELETE WITH AUDIT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Perform a counted delete with pre-deletion audit logging.
 *
 * 1. Count matching rows
 * 2. Log audit entry with count
 * 3. Perform actual delete
 * 4. Return result
 *
 * @param adminClient - Service role Supabase client
 * @param table - Table name
 * @param filterFn - Function that applies filters to a query builder
 * @param auditParams - Audit parameters (organizationId, userId, reason, etc.)
 * @param dryRun - If true, skip actual deletion
 */
export async function countedDeleteWithAudit(
  adminClient: SupabaseClient,
  table: string,
  filterColumn: string,
  filterOp: "eq" | "lt" | "lte" | "gt" | "gte" | "in",
  filterValue: unknown,
  auditParams: Omit<DeleteAuditParams, "table" | "filter" | "count">,
  dryRun = false,
): Promise<BatchDeleteResult> {
  // 1. Count
  // deno-lint-ignore no-explicit-any
  let query: any = adminClient.from(table).select("id", { count: "exact", head: true });
  query = applyFilter(query, filterColumn, filterOp, filterValue);

  const { count } = await query;
  const matchCount = count ?? 0;

  if (matchCount === 0) {
    return { table, deletedCount: 0 };
  }

  // 2. Audit
  await auditBeforeDelete(adminClient, {
    ...auditParams,
    table,
    filter: { [filterColumn]: filterValue, op: filterOp },
    count: matchCount,
  });

  // 3. Delete (unless dry run)
  if (!dryRun) {
    // deno-lint-ignore no-explicit-any
    let deleteQuery: any = adminClient.from(table).delete();
    deleteQuery = applyFilter(deleteQuery, filterColumn, filterOp, filterValue);

    const { error } = await deleteQuery;
    if (error) {
      return { table, deletedCount: 0, error: error.message };
    }
  }

  return { table, deletedCount: matchCount };
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Supabase query builder with filter methods */
interface FilterableQuery {
  eq(column: string, value: unknown): FilterableQuery;
  lt(column: string, value: unknown): FilterableQuery;
  lte(column: string, value: unknown): FilterableQuery;
  gt(column: string, value: unknown): FilterableQuery;
  gte(column: string, value: unknown): FilterableQuery;
  in(column: string, value: unknown): FilterableQuery;
}

// deno-lint-ignore no-explicit-any
function applyFilter(query: any, column: string, op: string, value: unknown): any {
  switch (op) {
    case "eq": return query.eq(column, value) as T;
    case "lt": return query.lt(column, value) as T;
    case "lte": return query.lte(column, value) as T;
    case "gt": return query.gt(column, value) as T;
    case "gte": return query.gte(column, value) as T;
    case "in": return query.in(column, value) as T;
    default: return query.eq(column, value) as T;
  }
}
