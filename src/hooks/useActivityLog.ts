import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DateRangeOption = "24h" | "7d" | "30d";

export interface ActivityLogFilters {
  dateRange: DateRangeOption;
  actionType: string | null;
  page: number;
  pageSize: number;
}

export interface AuditLogRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface AuditLogResult {
  data: AuditLogRow[];
  count: number;
}

function getDateThreshold(range: DateRangeOption): string {
  const now = new Date();
  switch (range) {
    case "24h":
      now.setHours(now.getHours() - 24);
      break;
    case "7d":
      now.setDate(now.getDate() - 7);
      break;
    case "30d":
      now.setDate(now.getDate() - 30);
      break;
  }
  return now.toISOString();
}

async function fetchAuditLogs(filters: ActivityLogFilters): Promise<AuditLogResult> {
  const { dateRange, actionType, page, pageSize } = filters;
  const threshold = getDateThreshold(dateRange);
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    .gte("created_at", threshold)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (actionType) {
    query = query.eq("action", actionType);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return {
    data: (data ?? []) as AuditLogRow[],
    count: count ?? 0,
  };
}

/**
 * Fetches distinct action types for the filter dropdown.
 */
async function fetchActionTypes(): Promise<string[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("action")
    .order("action", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  // Deduplicate action types
  const unique = [...new Set((data ?? []).map((row) => row.action))];
  return unique;
}

export function useActivityLog(filters: ActivityLogFilters) {
  return useQuery({
    queryKey: ["audit-logs", filters.dateRange, filters.actionType, filters.page, filters.pageSize],
    queryFn: () => fetchAuditLogs(filters),
    staleTime: 30_000,
  });
}

export function useActionTypes() {
  return useQuery({
    queryKey: ["audit-logs-action-types"],
    queryFn: fetchActionTypes,
    staleTime: 60_000,
  });
}
