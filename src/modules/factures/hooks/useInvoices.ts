/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURES — Main Data Hook V1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hook principal pour charger les factures et fournisseurs.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { Invoice, MonthNavigation } from "../types";
import { toYearMonthString } from "../types";
import { getMonthEndDateKeyParis } from "@/lib/time/dateKeyParis";

interface SupplierInfo {
  id: string;
  name: string;
}

/**
 * Hook pour charger les factures d'un mois
 */
export function useMonthInvoices(nav: MonthNavigation) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  const yearMonth = toYearMonthString(nav);
  const startDate = `${yearMonth}-01`;
  // FIXED: Use timezone-safe helper to avoid truncating last day of month
  const endDate = getMonthEndDateKeyParis(nav.year, nav.month - 1);

  return useQuery({
    queryKey: ["factures", "month", establishmentId, yearMonth],
    queryFn: async (): Promise<Invoice[]> => {
      if (!establishmentId) return [];

      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id, establishment_id, organization_id, supplier_id, supplier_name, supplier_name_normalized, invoice_number, invoice_date, amount_eur, file_path, file_name, file_size, file_type, is_paid, created_by, created_at, updated_at, amount_ht, vat_rate, vat_amount"
        )
        .eq("establishment_id", establishmentId)
        .gte("invoice_date", startDate)
        .lte("invoice_date", endDate)
        .order("invoice_date", { ascending: false });

      if (error) {
        if (import.meta.env.DEV) console.error("[useMonthInvoices] error:", error);
        throw error;
      }

      return (data || []) as Invoice[];
    },
    enabled: !!establishmentId,
  });
}

/**
 * Hook pour charger les factures d'un fournisseur pour un mois
 */
export function useSupplierMonthInvoices(supplierId: string | null, nav: MonthNavigation) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  const yearMonth = toYearMonthString(nav);
  const startDate = `${yearMonth}-01`;
  // FIXED: Use timezone-safe helper to avoid truncating last day of month
  const endDate = getMonthEndDateKeyParis(nav.year, nav.month - 1);

  return useQuery({
    queryKey: ["factures", "supplier", establishmentId, supplierId, yearMonth],
    queryFn: async (): Promise<Invoice[]> => {
      if (!establishmentId || !supplierId) return [];

      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id, establishment_id, organization_id, supplier_id, supplier_name, supplier_name_normalized, invoice_number, invoice_date, amount_eur, file_path, file_name, file_size, file_type, is_paid, created_by, created_at, updated_at, amount_ht, vat_rate, vat_amount"
        )
        .eq("establishment_id", establishmentId)
        .eq("supplier_id", supplierId)
        .gte("invoice_date", startDate)
        .lte("invoice_date", endDate)
        .order("invoice_date", { ascending: false });

      if (error) {
        if (import.meta.env.DEV) console.error("[useSupplierMonthInvoices] error:", error);
        throw error;
      }

      return (data || []) as Invoice[];
    },
    enabled: !!establishmentId && !!supplierId,
  });
}

/**
 * Relevé de compte mensuel (depuis invoice_monthly_statements)
 */
export interface MonthlyStatement {
  id: string;
  supplier_id: string;
  year_month: string;
  statement_amount_eur: number;
  gap_eur: number | null;
  status: string;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  file_type: string | null;
  created_at: string;
  created_by: string;
}

/**
 * Hook pour charger les relevés de compte d'un fournisseur pour un mois
 */
export function useSupplierStatements(supplierId: string | null, nav: MonthNavigation) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;
  const yearMonth = toYearMonthString(nav);

  return useQuery({
    queryKey: ["factures", "statements", establishmentId, supplierId, yearMonth],
    queryFn: async (): Promise<MonthlyStatement[]> => {
      if (!establishmentId || !supplierId) return [];

      const { data, error } = await supabase
        .from("invoice_monthly_statements")
        .select(
          "id, supplier_id, year_month, statement_amount_eur, gap_eur, status, file_path, file_name, file_size, file_type, created_at, created_by"
        )
        .eq("establishment_id", establishmentId)
        .eq("supplier_id", supplierId)
        .eq("year_month", yearMonth)
        .order("created_at", { ascending: false });

      if (error) {
        if (import.meta.env.DEV) console.error("[useSupplierStatements] error:", error);
        throw error;
      }

      return (data || []) as MonthlyStatement[];
    },
    enabled: !!establishmentId && !!supplierId,
  });
}

/**
 * Hook pour charger tous les fournisseurs de l'établissement
 */
export function useSuppliers() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["factures", "suppliers", establishmentId],
    queryFn: async (): Promise<Map<string, SupplierInfo>> => {
      if (!establishmentId) return new Map();

      const { data, error } = await supabase
        .from("invoice_suppliers")
        .select("id, name")
        .eq("establishment_id", establishmentId)
        .eq("status", "active");

      if (error) {
        if (import.meta.env.DEV) console.error("[useSuppliers] error:", error);
        throw error;
      }

      const map = new Map<string, SupplierInfo>();
      for (const supplier of data || []) {
        map.set(supplier.id, { id: supplier.id, name: supplier.name });
      }
      return map;
    },
    enabled: !!establishmentId,
  });
}
