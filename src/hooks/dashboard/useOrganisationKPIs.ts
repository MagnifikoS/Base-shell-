/**
 * useOrganisationKPIs — Fetches cross-establishment KPIs for the Organisation Dashboard.
 *
 * Queries badge_events, planning_shifts, and personnel_leave_requests
 * across ALL establishments the user has access to (via RLS).
 * Uses batch queries with `.in("establishment_id", ...)` for efficiency.
 *
 * SSOT: Uses formatParisDateKey for timezone-safe date keys.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { formatParisDateKey } from "@/lib/time/dateKeyParis";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface EstablishmentSummary {
  id: string;
  name: string;
  status: "active" | "archived";
  /** Number of employees who have clocked in today */
  employeesPresent: number;
  /** Number of employees with shifts planned today */
  employeesPlanned: number;
  /** Presence rate (0-100) */
  presenceRate: number;
  /** Number of pending leave requests */
  pendingLeaves: number;
  /** Total badge events today */
  todayBadgeEvents: number;
}

export interface OrganisationKPIs {
  organizationName: string;
  organizationId: string;
  totalEstablishments: number;
  activeEstablishments: number;
  totalEmployeesPresent: number;
  totalEmployeesPlanned: number;
  overallPresenceRate: number;
  totalPendingLeaves: number;
  establishments: EstablishmentSummary[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════════════

export function useOrganisationKPIs() {
  const { user } = useAuth();
  const { establishments } = useEstablishment();

  return useQuery<OrganisationKPIs | null>({
    queryKey: ["organisation-kpis", user?.id, establishments.map((e) => e.id).join(",")],
    queryFn: async (): Promise<OrganisationKPIs | null> => {
      if (!user || establishments.length === 0) return null;

      // Today's date key in Europe/Paris timezone (SSOT)
      const todayKey = formatParisDateKey(new Date());

      // Get the organization info from the first establishment
      const orgId = establishments[0].organization_id;
      const activeEstablishments = establishments.filter((e) => e.status === "active");
      const estIds = activeEstablishments.map((e) => e.id);

      if (estIds.length === 0) return null;

      // Fetch organization name
      const orgPromise = supabase.from("organizations").select("name").eq("id", orgId).single();

      // Batch: badge_events for today across all establishments
      // We count distinct user_ids for "present" and total rows for badge events
      const badgePromise = supabase
        .from("badge_events")
        .select("id, user_id, establishment_id, event_type")
        .in("establishment_id", estIds)
        .eq("day_date", todayKey);

      // Batch: planning_shifts for today across all establishments
      const planningPromise = supabase
        .from("planning_shifts")
        .select("id, user_id, establishment_id")
        .in("establishment_id", estIds)
        .eq("shift_date", todayKey);

      // Batch: pending leave requests across all establishments
      const leavesPromise = supabase
        .from("personnel_leave_requests")
        .select("id, establishment_id")
        .in("establishment_id", estIds)
        .eq("status", "pending");

      // Execute all in parallel
      const [orgResult, badgeResult, planningResult, leavesResult] = await Promise.all([
        orgPromise,
        badgePromise,
        planningPromise,
        leavesPromise,
      ]);

      const orgName = orgResult.data?.name ?? "Organisation";
      const badges = badgeResult.data ?? [];
      const shifts = planningResult.data ?? [];
      const leaves = leavesResult.data ?? [];

      // Group by establishment_id
      const badgesByEst = new Map<string, typeof badges>();
      for (const b of badges) {
        const arr = badgesByEst.get(b.establishment_id) ?? [];
        arr.push(b);
        badgesByEst.set(b.establishment_id, arr);
      }

      const shiftsByEst = new Map<string, typeof shifts>();
      for (const s of shifts) {
        const arr = shiftsByEst.get(s.establishment_id) ?? [];
        arr.push(s);
        shiftsByEst.set(s.establishment_id, arr);
      }

      const leavesByEst = new Map<string, typeof leaves>();
      for (const l of leaves) {
        const arr = leavesByEst.get(l.establishment_id) ?? [];
        arr.push(l);
        leavesByEst.set(l.establishment_id, arr);
      }

      // Build per-establishment summaries
      const summaries: EstablishmentSummary[] = activeEstablishments.map((est) => {
        const estBadges = badgesByEst.get(est.id) ?? [];
        const estShifts = shiftsByEst.get(est.id) ?? [];
        const estLeaves = leavesByEst.get(est.id) ?? [];

        // Unique users who clocked in today
        const presentUserIds = new Set(
          estBadges.filter((b) => b.event_type === "clock_in").map((b) => b.user_id)
        );
        // Unique users with planned shifts today
        const plannedUserIds = new Set(estShifts.map((s) => s.user_id));

        const employeesPresent = presentUserIds.size;
        const employeesPlanned = plannedUserIds.size;
        const presenceRate =
          employeesPlanned > 0 ? Math.round((employeesPresent / employeesPlanned) * 100) : 0;

        return {
          id: est.id,
          name: est.name,
          status: est.status as "active" | "archived",
          employeesPresent,
          employeesPlanned,
          presenceRate,
          pendingLeaves: estLeaves.length,
          todayBadgeEvents: estBadges.length,
        };
      });

      // Aggregate totals
      const totalEmployeesPresent = summaries.reduce((s, e) => s + e.employeesPresent, 0);
      const totalEmployeesPlanned = summaries.reduce((s, e) => s + e.employeesPlanned, 0);
      const overallPresenceRate =
        totalEmployeesPlanned > 0
          ? Math.round((totalEmployeesPresent / totalEmployeesPlanned) * 100)
          : 0;
      const totalPendingLeaves = summaries.reduce((s, e) => s + e.pendingLeaves, 0);

      return {
        organizationName: orgName,
        organizationId: orgId,
        totalEstablishments: establishments.length,
        activeEstablishments: activeEstablishments.length,
        totalEmployeesPresent,
        totalEmployeesPlanned,
        overallPresenceRate,
        totalPendingLeaves,
        establishments: summaries,
      };
    },
    enabled: !!user && establishments.length > 0,
    staleTime: 60_000, // 1 minute
    refetchInterval: 60_000, // auto-refresh every minute
  });
}
