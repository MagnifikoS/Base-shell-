/**
 * PAYROLL VALIDATION MUTATION HOOK
 *
 * Calls the payroll-validation edge function to upsert validation flags
 * for a specific employee-month.
 *
 * PARTIAL EXTRAS PAYMENT:
 * - extras_paid_eur: partial amount paid on salary (NULL = pay full amount)
 *
 * PARTIAL NET/CASH PAYMENT:
 * - netAmountPaid: partial virement amount (null = full if netPaid=true)
 * - cashAmountPaid: partial especes amount (null = full if cashPaid=true)
 *
 * R-Extra is calculated on-the-fly (SSOT unique), never stored.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PayrollValidationFlags } from "@/lib/payroll/payroll.compute";

export interface UpdateValidationParams {
  establishmentId: string;
  userId: string;
  yearMonth: string;
  includeExtras: boolean;
  includeAbsences: boolean;
  includeDeductions: boolean;
  cashPaid: boolean;
  netPaid: boolean;
  extrasPaidEur?: number | null;
  netAmountPaid?: number | null;
  cashAmountPaid?: number | null;
}

interface ValidationResult {
  success: boolean;
  data?: {
    id: string;
    establishment_id: string;
    user_id: string;
    year_month: string;
    include_extras: boolean;
    include_absences: boolean;
    include_deductions: boolean;
    cash_paid: boolean;
    net_paid: boolean;
    extras_paid_eur: number | null;
    net_amount_paid: number | null;
    cash_amount_paid: number | null;
    updated_at: string;
    updated_by: string;
  };
  error?: string;
}

export function usePayrollValidation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UpdateValidationParams): Promise<ValidationResult> => {
      const {
        establishmentId,
        userId,
        yearMonth,
        includeExtras,
        includeAbsences,
        includeDeductions,
        cashPaid,
        netPaid,
        extrasPaidEur,
        netAmountPaid,
        cashAmountPaid,
      } = params;

      const { data, error } = await supabase.functions.invoke("payroll-validation", {
        body: {
          establishment_id: establishmentId,
          user_id: userId,
          year_month: yearMonth,
          include_extras: includeExtras,
          include_absences: includeAbsences,
          include_deductions: includeDeductions,
          cash_paid: cashPaid,
          net_paid: netPaid,
          extras_paid_eur: extrasPaidEur,
          net_amount_paid: netAmountPaid,
          cash_amount_paid: cashAmountPaid,
        },
      });

      if (error) {
        throw new Error(error.message || "Failed to update validation");
      }

      return data as ValidationResult;
    },
    // Optimistic update: instantly update cache before server responds
    onMutate: async (variables) => {
      const queryKey = ["payroll", "month", variables.establishmentId, variables.yearMonth];

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous value
      const previousData = queryClient.getQueryData(queryKey);

      // Optimistically update cache
      queryClient.setQueryData(queryKey, (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        const data = old as {
          validationByUserId?: Map<string, PayrollValidationFlags>;
        };

        if (data.validationByUserId) {
          const newMap = new Map(data.validationByUserId);
          newMap.set(variables.userId, {
            includeExtras: variables.includeExtras,
            includeAbsences: variables.includeAbsences,
            includeDeductions: variables.includeDeductions,
            cashPaid: variables.cashPaid,
            netPaid: variables.netPaid,
            extrasPaidEur: variables.extrasPaidEur ?? null,
            netAmountPaid: variables.netAmountPaid ?? null,
            cashAmountPaid: variables.cashAmountPaid ?? null,
          });
          return { ...data, validationByUserId: newMap };
        }
        return old;
      });

      return { previousData, queryKey };
    },
    onError: (error: Error, _, context) => {
      // Rollback on error
      if (context?.previousData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
      toast.error(error.message || "Une erreur est survenue lors de la validation");
    },
    onSettled: (_, __, variables) => {
      // Always refetch after mutation settles to ensure consistency
      queryClient.invalidateQueries({
        queryKey: ["payroll", "month", variables.establishmentId, variables.yearMonth],
      });
    },
  });
}
