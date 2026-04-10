/**
 * PAYROLL DATA HOOK — Fetch-only, NO business logic
 *
 * This hook fetches all required data for the Payroll module.
 * ALL calculations are delegated to payroll.compute.ts (single source of truth).
 *
 * Data sources:
 * - employee_details: gross_salary, net_salary, contract_hours
 * - extra_events: status = 'approved' only
 * - personnel_leaves: status = 'approved', types 'cp'/'absence' (repos excluded)
 * - badge_events: late_minutes (clock_in), early_departure_minutes (clock_out)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🛑 SSOT RULE: early_departure_minutes
 * ═══════════════════════════════════════════════════════════════════════════════
 * DO NOT recompute early departure on frontend!
 *
 * Source of Truth: badge_events.early_departure_minutes (DB column)
 * Computed by: badge-events Edge Function → checkEarlyDeparture()
 * Stored at: INSERT/UPDATE of clock_out event
 *
 * ❌ FORBIDDEN:
 *   - import { computeEarlyDeparture* } from any module
 *   - Dynamic calculation comparing clock_out.effective_at vs planning_shifts
 *   - Any frontend logic that recalculates early departure minutes
 *
 * ✅ ALLOWED:
 *   - SELECT early_departure_minutes FROM badge_events WHERE event_type = 'clock_out'
 *   - SUM(early_departure_minutes) for aggregations
 *
 * See: /docs/ssot-early-departure.md
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NO formulas here. NO reduce/sum for currency. Just data preparation.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
// ❌ REMOVED: import { computeEarlyDepartureMinutes } - SSOT is now DB
import { computeCpBalances } from "@/lib/payroll/cp.compute";
import {
  computePayrollEmployeeLine,
  computePayrollTotalsFromEmployees,
  computePlanningPayrollCost,
  countCpDays,
  countAbsenceDays,
  sumLateMinutes,
  type EmployeeContract,
  type PayrollEmployeeLine,
  type PayrollTotals,
  type PayrollValidationFlags,
  type PlanningShiftRaw,
} from "@/lib/payroll/payroll.compute";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PayrollEmployeeData {
  userId: string;
  fullName: string;
  email: string;
  /** Computed payroll line (from engine) - includes workedMinutesMonth */
  line: PayrollEmployeeLine;
}

/** Planning payroll breakdown by team (Phase A2) */
export interface PlanningPayrollByTeam {
  teamId: string | null;
  teamName: string;
  costEur: number;
  hours: number;
}

export interface UsePayrollMonthDataResult {
  employees: PayrollEmployeeData[];
  totals: PayrollTotals;
  /** Total planning payroll cost (sum of net_minutes × hourlyRate for all employees) */
  planningPayrollTotal: number;
  /** Planning payroll breakdown by team (Phase A2) */
  planningPayrollByTeam: PlanningPayrollByTeam[];
  /** Validation flags by userId (from payroll_employee_month_validation) */
  validationByUserId: Map<string, PayrollValidationFlags>;
  /**
   * R-Extra balance by userId (SSOT: calculated all-time from backend)
   * Formula: detected - paid - consumed
   */
  rextraBalanceByUserId: Map<string, number>;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getMonthBounds(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

/**
 * Get week-bounded fetch window for planning shifts (hebdo extras calculation)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🛑 PLANNING EXTRAS SSOT — Fenêtre Borne Semaine
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Pour calculer les extras hebdo conformément au Code du travail, on doit
 * récupérer TOUTES les semaines civiles qui peuvent être rattachées au mois.
 *
 * Fenêtre: Du LUNDI de la semaine contenant le 1er du mois
 *          Au DIMANCHE de la semaine contenant le dernier jour du mois
 *
 * Cela garantit 0% de semaines tronquées (vs ±7 jours qui peut échouer).
 *
 * @see /docs/payroll-extras-contract.md
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function getWeekBoundedFetchWindow(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split("-").map(Number);

  // 1er jour du mois
  const firstOfMonth = new Date(year, month - 1, 1);
  // Dernier jour du mois
  const lastOfMonth = new Date(year, month, 0);

  // Lundi de la semaine contenant le 1er du mois
  // getDay(): 0=dim, 1=lun, ..., 6=sam
  const dayOfWeekFirst = firstOfMonth.getDay();
  const daysToSubtract = dayOfWeekFirst === 0 ? 6 : dayOfWeekFirst - 1; // lundi = 0 jours
  const mondayOfFirstWeek = new Date(firstOfMonth);
  mondayOfFirstWeek.setDate(firstOfMonth.getDate() - daysToSubtract);

  // Dimanche de la semaine contenant le dernier jour du mois
  const dayOfWeekLast = lastOfMonth.getDay();
  const daysToAdd = dayOfWeekLast === 0 ? 0 : 7 - dayOfWeekLast; // dimanche = 0 jours
  const sundayOfLastWeek = new Date(lastOfMonth);
  sundayOfLastWeek.setDate(lastOfMonth.getDate() + daysToAdd);

  // Format YYYY-MM-DD
  const formatDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  return {
    start: formatDate(mondayOfFirstWeek),
    end: formatDate(sundayOfLastWeek),
  };
}

/**
 * Get previous month from a YYYY-MM string
 */
function _getPreviousMonthFrom(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

/**
 * Get previous month in YYYY-MM format
 */
export function getPreviousMonth(): string {
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Get current month in YYYY-MM format
 */
export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────────────────────────────────────

export function usePayrollMonthData(yearMonth: string): UsePayrollMonthDataResult {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id || null;
  const organizationId = activeEstablishment?.organization_id || null;

  const query = useQuery({
    queryKey: ["payroll", "month", establishmentId, yearMonth],
    queryFn: async () => {
      if (!establishmentId || !organizationId) {
        throw new Error("Missing establishment or organization context");
      }

      const { start, end } = getMonthBounds(yearMonth);

      // ─────────────────────────────────────────────────────────────────────
      // 1. Fetch active employees for this establishment
      // ─────────────────────────────────────────────────────────────────────
      const { data: userEstablishments, error: ueError } = await supabase
        .from("user_establishments")
        .select("user_id")
        .eq("establishment_id", establishmentId);

      if (ueError) throw new Error(`user_establishments: ${ueError.message}`);

      const allUserIds = (userEstablishments || []).map((ue) => ue.user_id);

      // Filter out inactive employees (disabled/suspended) — same logic as planning
      let activeUserIds = allUserIds;
      if (allUserIds.length > 0) {
        const { data: activeProfiles, error: profileError } = await supabase
          .from("profiles")
          .select("user_id")
          .in("user_id", allUserIds)
          .eq("status", "active");

        if (profileError) throw new Error(`profiles filter: ${profileError.message}`);
        const activeSet = new Set((activeProfiles || []).map((p) => p.user_id));
        activeUserIds = allUserIds.filter((id) => activeSet.has(id));
      }
      if (activeUserIds.length === 0) {
        return {
          employees: [],
          totals: emptyTotals(),
          planningPayrollTotal: 0,
          planningPayrollByTeam: [],
          validationByUserId: new Map(),
          rextraBalanceByUserId: new Map(),
        };
      }

      // ─────────────────────────────────────────────────────────────────────
      // Batch 2: All parallel queries (depend on activeUserIds)
      // Week-bounded window for planning shifts (hebdo extras calculation)
      // ═══════════════════════════════════════════════════════════════════════
      // SSOT PLANNING EXTRAS: Fenêtre élargie (lundi 1ère semaine → dimanche dernière semaine)
      // Cela permet à l'engine de calculer les extras par semaine civile sans troncature.
      // Le hook fournit les shifts BRUTS, l'engine fait le groupement hebdomadaire.
      // @see /docs/payroll-extras-contract.md
      // ═══════════════════════════════════════════════════════════════════════
      const weekBounds = getWeekBoundedFetchWindow(yearMonth);

      const [
        profilesResult,
        contractsResult,
        extraEventsResult,
        leavesResult,
        badgeEventsResult,
        planningShiftsResult,
        validationsResult,
        userTeamsResult,
      ] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, email").in("user_id", activeUserIds),
        supabase
          .from("employee_details")
          .select("user_id, gross_salary, net_salary, contract_hours, cp_n1, cp_n, total_salary")
          .in("user_id", activeUserIds),
        supabase
          .from("extra_events")
          .select("user_id, extra_minutes, day_date, status")
          .eq("establishment_id", establishmentId)
          .eq("status", "approved")
          .gte("day_date", start)
          .lte("day_date", end),
        supabase
          .from("personnel_leaves")
          .select("user_id, leave_type, leave_date")
          .eq("establishment_id", establishmentId)
          .eq("status", "approved")
          .in("leave_type", ["cp", "absence"])
          .gte("leave_date", start)
          .lte("leave_date", end),
        supabase
          .from("badge_events")
          .select(
            "user_id, event_type, late_minutes, early_departure_minutes, day_date, effective_at"
          )
          .eq("establishment_id", establishmentId)
          .gte("day_date", start)
          .lte("day_date", end),
        supabase
          .from("planning_shifts")
          .select("user_id, shift_date, start_time, end_time, net_minutes")
          .eq("establishment_id", establishmentId)
          .gte("shift_date", weekBounds.start)
          .lte("shift_date", weekBounds.end),
        supabase
          .from("payroll_employee_month_validation")
          .select("*")
          .eq("establishment_id", establishmentId)
          .eq("year_month", yearMonth),
        supabase.from("user_teams").select("user_id, team_id").in("user_id", activeUserIds),
      ]);

      // Check errors from Batch 2
      if (profilesResult.error) throw new Error(`profiles: ${profilesResult.error.message}`);
      if (contractsResult.error)
        throw new Error(`employee_details: ${contractsResult.error.message}`);
      if (extraEventsResult.error)
        throw new Error(`extra_events: ${extraEventsResult.error.message}`);
      if (leavesResult.error) throw new Error(`personnel_leaves: ${leavesResult.error.message}`);
      if (badgeEventsResult.error)
        throw new Error(`badge_events: ${badgeEventsResult.error.message}`);
      if (planningShiftsResult.error)
        throw new Error(`planning_shifts: ${planningShiftsResult.error.message}`);
      if (validationsResult.error)
        throw new Error(`payroll_employee_month_validation: ${validationsResult.error.message}`);
      if (userTeamsResult.error) throw new Error(`user_teams: ${userTeamsResult.error.message}`);

      const profiles = profilesResult.data;
      const contracts = contractsResult.data;
      const extraEvents = extraEventsResult.data;
      const leaves = leavesResult.data;
      const badgeEvents = badgeEventsResult.data;
      const planningShifts = planningShiftsResult.data;
      const validations = validationsResult.data;
      const userTeams = userTeamsResult.data;

      // ─────────────────────────────────────────────────────────────────────
      // Build Maps from Batch 2 results
      // ─────────────────────────────────────────────────────────────────────

      // Profiles map
      const profileMap = new Map<string, { fullName: string; email: string }>();
      for (const p of profiles || []) {
        profileMap.set(p.user_id, {
          fullName: p.full_name || p.email,
          email: p.email,
        });
      }

      // Contracts map
      const contractMap = new Map<
        string,
        {
          gross_salary: number | null;
          net_salary: number | null;
          contract_hours: number | null;
          cp_n1: number | null;
          cp_n: number | null;
          total_salary: number | null;
        }
      >();
      for (const c of contracts || []) {
        contractMap.set(c.user_id, {
          gross_salary: c.gross_salary,
          net_salary: c.net_salary,
          contract_hours: c.contract_hours,
          cp_n1: c.cp_n1,
          cp_n: c.cp_n,
          total_salary: c.total_salary,
        });
      }

      // Group extras by user
      const extrasByUser = new Map<
        string,
        { extra_minutes: number; status: "pending" | "approved" | "rejected" }[]
      >();
      for (const ev of extraEvents || []) {
        const list = extrasByUser.get(ev.user_id) || [];
        list.push({
          extra_minutes: ev.extra_minutes,
          status: ev.status as "pending" | "approved" | "rejected",
        });
        extrasByUser.set(ev.user_id, list);
      }

      // Group leaves by user
      const leavesByUser = new Map<string, { leave_type: string; leave_date: string }[]>();
      for (const l of leaves || []) {
        const list = leavesByUser.get(l.user_id) || [];
        list.push({ leave_type: l.leave_type, leave_date: l.leave_date });
        leavesByUser.set(l.user_id, list);
      }

      // Group badge events by user
      // PHASE 1.3 SSOT: Read early_departure_minutes directly from DB (no recalc)
      const badgesByUser = new Map<
        string,
        {
          event_type: string;
          late_minutes: number | null;
          early_departure_minutes: number | null;
          day_date: string;
          effective_at: string;
        }[]
      >();
      for (const b of badgeEvents || []) {
        const list = badgesByUser.get(b.user_id) || [];
        list.push({
          event_type: b.event_type,
          late_minutes: b.late_minutes,
          early_departure_minutes: b.early_departure_minutes,
          day_date: b.day_date,
          effective_at: b.effective_at,
        });
        badgesByUser.set(b.user_id, list);
      }

      // Group shifts by user (raw data, NO week grouping here - engine does that)
      const shiftsByUser = new Map<
        string,
        { shift_date: string; start_time: string; end_time: string; net_minutes: number }[]
      >();
      for (const s of planningShifts || []) {
        const list = shiftsByUser.get(s.user_id) || [];
        list.push({
          shift_date: s.shift_date,
          start_time: s.start_time,
          end_time: s.end_time,
          net_minutes: s.net_minutes,
        });
        shiftsByUser.set(s.user_id, list);
      }

      // Build validation map
      const validationByUserId = new Map<string, PayrollValidationFlags>();
      for (const v of validations || []) {
        validationByUserId.set(v.user_id, {
          includeExtras: v.include_extras,
          includeAbsences: v.include_absences,
          includeDeductions: v.include_deductions,
          cashPaid: v.cash_paid,
          netPaid: v.net_paid,
          extrasPaidEur: v.extras_paid_eur ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          netAmountPaid: (v as any).net_amount_paid ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cashAmountPaid: (v as any).cash_amount_paid ?? null,
        });
      }

      // Build user -> team map (first team if multiple)
      const userTeamMap = new Map<string, string | null>();
      for (const ut of userTeams || []) {
        if (!userTeamMap.has(ut.user_id)) {
          userTeamMap.set(ut.user_id, ut.team_id);
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // Batch 3: teams + R-Extra balances (parallel, depend on userTeams)
      // ─────────────────────────────────────────────────────────────────────
      const teamIds = [
        ...new Set((userTeams || []).map((ut) => ut.team_id).filter(Boolean)),
      ] as string[];

      const [teamsResult, rextraResult] = await Promise.all([
        teamIds.length > 0
          ? supabase.from("teams").select("id, name").in("id", teamIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
        supabase.functions
          .invoke("payroll-rextra-balance", {
            body: {
              action: "get_balances",
              establishment_id: establishmentId,
              user_ids: activeUserIds,
            },
          })
          .catch((e) => {
            if (import.meta.env.DEV)
              console.warn("[usePayrollMonthData] Failed to fetch R-Extra balances:", e);
            return { data: null, error: e };
          }),
      ]);

      if (teamsResult.error) throw new Error(`teams: ${teamsResult.error.message}`);

      const teamNameMap = new Map<string, string>();
      for (const t of teamsResult.data || []) {
        teamNameMap.set(t.id, t.name);
      }

      // Build R-Extra balance map
      const rextraBalanceByUserId = new Map<string, number>();
      const rextraData = rextraResult?.data;
      if (rextraData?.success && rextraData?.data?.rextraBalanceByEmployee) {
        const balances = rextraData.data.rextraBalanceByEmployee as Record<string, number>;
        for (const [userId, minutes] of Object.entries(balances)) {
          rextraBalanceByUserId.set(userId, minutes);
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // 10. Compute payroll lines using the ENGINE (single source)
      // ─────────────────────────────────────────────────────────────────────
      const employeeData: PayrollEmployeeData[] = [];

      for (const userId of activeUserIds) {
        const profile = profileMap.get(userId);
        if (!profile) continue;

        const rawContract = contractMap.get(userId);
        const contract: EmployeeContract = {
          gross_salary: rawContract?.gross_salary ?? 0,
          net_salary: rawContract?.net_salary ?? 0,
          contract_hours: rawContract?.contract_hours ?? 0,
          cp_n1: rawContract?.cp_n1 ?? null,
          cp_n: rawContract?.cp_n ?? null,
          total_salary: rawContract?.total_salary ?? null,
        };

        // Skip employees without contract data
        if (contract.contract_hours === 0 || contract.gross_salary === 0) {
          continue;
        }

        const extraEvents = extrasByUser.get(userId) || [];
        const userLeaves = leavesByUser.get(userId) || [];
        const cpDays = countCpDays(userLeaves);
        // Declared absences from personnel_leaves (non-CP)
        const absenceDeclaredDays = countAbsenceDays(userLeaves);
        // Badge-derived absences (shifts finished without clock_in)
        const userShifts = shiftsByUser.get(userId) || [];
        const userBadges = badgesByUser.get(userId) || [];

        // Calculate badge-derived absences: shifts that finished but have no clock_in
        let absenceBadgeDays = 0;
        const now = new Date();
        for (const shift of userShifts) {
          const shiftEnd = new Date(`${shift.shift_date}T${shift.end_time}`);
          // Only count if shift has ended
          if (shiftEnd < now) {
            // Check if there's a clock_in for this shift date
            const hasClockIn = userBadges.some(
              (b) => b.day_date === shift.shift_date && b.event_type === "clock_in"
            );
            if (!hasClockIn) {
              absenceBadgeDays++;
            }
          }
        }

        const lateMinutes = sumLateMinutes(userBadges);

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 1.3 SSOT: Read early_departure_minutes directly from DB
        // ❌ NO MORE RECALCULATION - DB is the single source of truth
        // ═══════════════════════════════════════════════════════════════════
        const earlyDepartureMinutes = userBadges
          .filter((b) => b.event_type === "clock_out" && b.early_departure_minutes != null)
          .reduce((sum, b) => sum + (b.early_departure_minutes ?? 0), 0);

        // ═══════════════════════════════════════════════════════════════════
        // INFORMATIVE ONLY: workedMinutesMonth for display column "H. eff."
        // ❌ DO NOT use for extras calculation
        // ═══════════════════════════════════════════════════════════════════
        const workedMinutesMonth = userShifts.reduce((acc, s) => acc + (s.net_minutes || 0), 0);

        // ═══════════════════════════════════════════════════════════════════
        // SSOT: Raw shifts for weekly extras calculation
        // Engine will group by week (lun→dim) and calculate extras per week
        // ═══════════════════════════════════════════════════════════════════
        const shiftsRaw: PlanningShiftRaw[] = userShifts.map((s) => ({
          shift_date: s.shift_date,
          net_minutes: s.net_minutes,
        }));

        // Compute CP balances
        const cpBalancesResult = computeCpBalances({
          cpN1: contract.cp_n1 ?? 0,
          cpN: contract.cp_n ?? 0,
          cpTakenThisMonth: cpDays,
        });
        const cpBalances = {
          cpRemainingN1: cpBalancesResult.remainingCpN1,
          cpRemainingN: cpBalancesResult.remainingCpN,
        };

        // Compute payroll line using the engine with WEEKLY extras calculation
        const line = computePayrollEmployeeLine({
          contract,
          extraEvents,
          cpDays,
          absenceDeclaredDays,
          absenceBadgeDays,
          lateMinutesTotal: lateMinutes,
          earlyDepartureMinutesTotal: earlyDepartureMinutes,
          workedMinutesMonth, // Informative only
          shiftsRaw, // SSOT for weekly extras
          targetMonth: yearMonth, // For week→month attachment
          cpBalances,
        });

        employeeData.push({
          userId,
          fullName: profile.fullName,
          email: profile.email,
          line,
        });
      }

      // Sort by name
      employeeData.sort((a, b) => a.fullName.localeCompare(b.fullName));

      // ─────────────────────────────────────────────────────────────────────
      // 10. Compute totals using the ENGINE
      // ─────────────────────────────────────────────────────────────────────
      const employeesForTotals = employeeData.map((e) => ({
        userId: e.userId,
        line: e.line,
      }));
      const totals = computePayrollTotalsFromEmployees(employeesForTotals, validationByUserId);

      // ─────────────────────────────────────────────────────────────────────
      // 11. Compute planning payroll cost (sum of net_minutes × hourlyRate)
      // ─────────────────────────────────────────────────────────────────────
      let planningPayrollTotal = 0;
      const byTeamAgg = new Map<string | null, { costEur: number; hours: number }>();

      for (const { userId, line } of employeeData) {
        const userShifts = shiftsByUser.get(userId) || [];
        const totalNetMinutes = userShifts.reduce((acc, s) => acc + (s.net_minutes || 0), 0);
        const cost = computePlanningPayrollCost(totalNetMinutes, line.hourlyRateWithCash);
        planningPayrollTotal += cost;

        // Aggregate by team
        const teamId = userTeamMap.get(userId) ?? null;
        const existing = byTeamAgg.get(teamId) || { costEur: 0, hours: 0 };
        existing.costEur += cost;
        existing.hours += totalNetMinutes / 60;
        byTeamAgg.set(teamId, existing);
      }

      // Convert to array with team names
      const planningPayrollByTeam: PlanningPayrollByTeam[] = [];
      for (const [teamId, agg] of byTeamAgg) {
        planningPayrollByTeam.push({
          teamId,
          teamName: teamId ? teamNameMap.get(teamId) || "Équipe inconnue" : "Non assigné",
          costEur: agg.costEur,
          hours: agg.hours,
        });
      }
      // Sort by team name
      planningPayrollByTeam.sort((a, b) => a.teamName.localeCompare(b.teamName));

      return {
        employees: employeeData,
        totals,
        planningPayrollTotal,
        planningPayrollByTeam,
        validationByUserId,
        rextraBalanceByUserId,
      };
    },
    enabled: !!establishmentId && !!yearMonth,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
  });

  return {
    employees: query.data?.employees || [],
    totals: query.data?.totals || emptyTotals(),
    planningPayrollTotal: query.data?.planningPayrollTotal || 0,
    planningPayrollByTeam: query.data?.planningPayrollByTeam || [],
    validationByUserId: query.data?.validationByUserId || new Map(),
    rextraBalanceByUserId: query.data?.rextraBalanceByUserId || new Map(),
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

function emptyTotals(): PayrollTotals {
  return {
    totalGrossBase: 0,
    totalNetBase: 0,
    totalExtras: 0,
    totalCpDays: 0,
    totalAbsences: 0,
    totalDeductions: 0,
    // PHASE 2 - New fields
    totalMassToDisburse: 0,
    totalChargesFixed: 0,
    totalPayrollMass: 0,
    totalCashAmount: 0,
    // Deprecated (backward compat)
    totalGrossAdjusted: 0,
    remainingToPay: 0,
    totalGrossAdjustedValidated: 0,
    totalGrossDisplayed: 0,
    remainingToPayDisplayed: 0,
    totalNetWithCash: 0,
    totalGrossWithCash: 0,
  };
}
