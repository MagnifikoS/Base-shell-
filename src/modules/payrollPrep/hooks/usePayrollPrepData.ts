/**
 * PAYROLL PREP DATA HOOK — Fetch data for État Préparatoire
 *
 * Réutilise le cache et les queries Paie existants.
 * Sources : profiles, employee_details, personnel_leaves
 * AUCUN calcul métier, lecture seule.
 *
 * Timezone: Toutes les dates sont des strings ISO (YYYY-MM-DD) déjà normalisées Paris.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PayrollPrepEmployee {
  userId: string;
  fullName: string;
  position: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  contractHoursWeekly: number | null;
  cpDates: string[];
  absenceDates: string[];
  amDates: string[];
  hasNavigoPass: boolean;
}

interface UsePayrollPrepDataOptions {
  yearMonth: string;
  establishmentId: string | null;
}

/**
 * Calcule les bornes du mois (YYYY-MM-DD) sans utiliser new Date() avec timezone navigateur.
 * Utilise uniquement des calculs sur les strings ISO.
 */
function getMonthBounds(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;

  // Calcul du dernier jour du mois sans new Date()
  // Nombre de jours par mois (année bissextile gérée pour février)
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  const lastDay = daysInMonth[month - 1];

  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export function usePayrollPrepData({ yearMonth, establishmentId }: UsePayrollPrepDataOptions) {
  const query = useQuery({
    queryKey: ["payroll-prep", establishmentId, yearMonth],
    queryFn: async (): Promise<PayrollPrepEmployee[]> => {
      if (!establishmentId) {
        return [];
      }

      const { start, end } = getMonthBounds(yearMonth);

      // 1. Fetch active user IDs for this establishment
      const { data: userEstablishments, error: ueError } = await supabase
        .from("user_establishments")
        .select("user_id")
        .eq("establishment_id", establishmentId);

      if (ueError) throw new Error(`user_establishments: ${ueError.message}`);

      const activeUserIds = (userEstablishments || []).map((ue) => ue.user_id);
      if (activeUserIds.length === 0) {
        return [];
      }

      // 2. Fetch profiles (parallel)
      const profilesPromise = supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", activeUserIds);

      // 3. Fetch employee_details with contract_hours (parallel)
      const detailsPromise = supabase
        .from("employee_details")
        .select(
          "user_id, position, contract_start_date, contract_end_date, contract_hours, has_navigo_pass"
        )
        .in("user_id", activeUserIds);

      // 4. Fetch personnel_leaves for the month (parallel)
      const leavesPromise = supabase
        .from("personnel_leaves")
        .select("user_id, leave_type, leave_date")
        .eq("establishment_id", establishmentId)
        .eq("status", "approved")
        .in("leave_type", ["cp", "absence", "am"])
        .gte("leave_date", start)
        .lte("leave_date", end);

      const [profilesRes, detailsRes, leavesRes] = await Promise.all([
        profilesPromise,
        detailsPromise,
        leavesPromise,
      ]);

      if (profilesRes.error) throw new Error(`profiles: ${profilesRes.error.message}`);
      if (detailsRes.error) throw new Error(`employee_details: ${detailsRes.error.message}`);
      if (leavesRes.error) throw new Error(`personnel_leaves: ${leavesRes.error.message}`);

      // Build maps
      const profileMap = new Map<string, { fullName: string; email: string }>();
      for (const p of profilesRes.data || []) {
        profileMap.set(p.user_id, {
          fullName: p.full_name || p.email,
          email: p.email,
        });
      }

      const detailsMap = new Map<
        string,
        {
          position: string | null;
          contractStartDate: string | null;
          contractEndDate: string | null;
          contractHoursWeekly: number | null;
          hasNavigoPass: boolean;
        }
      >();
      for (const d of detailsRes.data || []) {
        detailsMap.set(d.user_id, {
          position: d.position,
          contractStartDate: d.contract_start_date,
          contractEndDate: d.contract_end_date,
          contractHoursWeekly: d.contract_hours,
          hasNavigoPass: d.has_navigo_pass ?? false,
        });
      }

      // Group leaves by user and type
      const cpByUser = new Map<string, string[]>();
      const absenceByUser = new Map<string, string[]>();
      const amByUser = new Map<string, string[]>();
      for (const l of leavesRes.data || []) {
        if (l.leave_type === "cp") {
          const list = cpByUser.get(l.user_id) || [];
          list.push(l.leave_date);
          cpByUser.set(l.user_id, list);
        } else if (l.leave_type === "absence") {
          const list = absenceByUser.get(l.user_id) || [];
          list.push(l.leave_date);
          absenceByUser.set(l.user_id, list);
        } else if (l.leave_type === "am") {
          const list = amByUser.get(l.user_id) || [];
          list.push(l.leave_date);
          amByUser.set(l.user_id, list);
        }
      }

      // Build employee list
      const employees: PayrollPrepEmployee[] = [];
      for (const userId of activeUserIds) {
        const profile = profileMap.get(userId);
        if (!profile) continue;

        const details = detailsMap.get(userId);

        employees.push({
          userId,
          fullName: profile.fullName,
          position: details?.position ?? null,
          contractStartDate: details?.contractStartDate ?? null,
          contractEndDate: details?.contractEndDate ?? null,
          contractHoursWeekly: details?.contractHoursWeekly ?? null,
          cpDates: cpByUser.get(userId) || [],
          absenceDates: absenceByUser.get(userId) || [],
          amDates: amByUser.get(userId) || [],
          hasNavigoPass: details?.hasNavigoPass ?? false,
        });
      }

      // Sort by name
      employees.sort((a, b) => a.fullName.localeCompare(b.fullName, "fr"));

      return employees;
    },
    enabled: !!establishmentId,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
  });

  return {
    employees: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
