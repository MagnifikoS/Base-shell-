/**
 * useEstablishmentKPIs — KPIs for the Establishment Dashboard.
 *
 * Fetches in parallel:
 * - Daily revenue from cash_day_reports (today + last 7 days for chart)
 * - Unpaid invoices count + top suppliers this month
 * - Products with stock alerts (min_stock configured)
 * - Active/recent inventory sessions
 *
 * All queries scoped to the active establishment.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMonthEndDateKeyParis } from "@/lib/time/dateKeyParis";

// ── Types ──────────────────────────────────────────────────────────────

export interface DailyRevenue {
  day_date: string;
  total_eur: number;
}

export interface TopSupplier {
  supplier_name: string;
  total_amount: number;
  invoice_count: number;
}

export interface InventorySessionSummary {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  counted_products: number;
  total_products: number;
  storage_zone_id: string;
}

export interface EstablishmentKPIs {
  // Revenue
  todayRevenue: number | null;
  revenueLastDays: DailyRevenue[];

  // Invoices
  unpaidInvoiceCount: number;
  monthExpenseTotal: number;
  topSuppliers: TopSupplier[];

  // Stock
  /** @deprecated Use productsMonitored instead — "stock alerts" label was misleading (STK-ALR-004) */
  stockAlertCount: number;
  /** Count of products with min_stock configured (produits surveillés) */
  productsMonitored: number;
  /** @deprecated Use productsMonitored instead */
  productsWithMinStock: number;

  // Inventory
  activeSessions: InventorySessionSummary[];
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Get YYYY-MM-DD for N days before a given date string */
function daysAgo(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonthStartFromDate(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01";
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useEstablishmentKPIs(establishmentId: string | null, serviceDay: string | null) {
  return useQuery<EstablishmentKPIs>({
    queryKey: ["establishment-kpis", establishmentId, serviceDay],
    enabled: !!establishmentId && !!serviceDay,
    staleTime: 60_000,
    queryFn: async (): Promise<EstablishmentKPIs> => {
      const estId = establishmentId!;
      const today = serviceDay!;
      const sevenDaysAgo = daysAgo(today, 6); // today + 6 previous = 7 days
      const monthStart = getMonthStartFromDate(today);
      const [yearStr, monthStr] = today.split("-");
      const monthEnd = getMonthEndDateKeyParis(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1);

      // ── Parallel fetches ────────────────────────────────────────────
      const [
        cashTodayResult,
        cashWeekResult,
        unpaidCountResult,
        monthInvoicesResult,
        minStockResult,
        activeSessionsResult,
      ] = await Promise.all([
        // 1. Today's revenue
        supabase
          .from("cash_day_reports")
          .select("total_eur")
          .eq("establishment_id", estId)
          .eq("day_date", today)
          .maybeSingle(),

        // 2. Last 7 days revenue (for chart)
        supabase
          .from("cash_day_reports")
          .select("day_date, total_eur")
          .eq("establishment_id", estId)
          .gte("day_date", sevenDaysAgo)
          .lte("day_date", today)
          .order("day_date", { ascending: true }),

        // 3. Unpaid invoices count
        supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("establishment_id", estId)
          .eq("is_paid", false),

        // 4. This month's invoices (for top suppliers)
        supabase
          .from("invoices")
          .select("supplier_name, supplier_id, amount_eur")
          .eq("establishment_id", estId)
          .gte("invoice_date", monthStart)
          .lte("invoice_date", monthEnd),

        // 5. Products with min_stock configured (simplified alert count)
        supabase
          .from("products_v2")
          .select("id, min_stock_quantity_canonical")
          .eq("establishment_id", estId)
          .is("archived_at", null)
          .not("min_stock_quantity_canonical", "is", null),

        // 6. Active inventory sessions
        supabase
          .from("inventory_sessions")
          .select(
            "id, status, started_at, completed_at, counted_products, total_products, storage_zone_id"
          )
          .eq("establishment_id", estId)
          .in("status", ["en_cours", "en_pause"])
          .order("started_at", { ascending: false })
          .limit(5),
      ]);

      // ── Today's revenue ──────────────────────────────────────────────
      const todayRevenue = cashTodayResult.data?.total_eur ?? null;

      // ── Revenue chart data ───────────────────────────────────────────
      const cashRows = cashWeekResult.data ?? [];
      // Build a full 7-day array (fill gaps with 0)
      const revenueLastDays: DailyRevenue[] = [];
      const cashMap = new Map(cashRows.map((r) => [r.day_date, r.total_eur]));
      for (let i = 6; i >= 0; i--) {
        const dateKey = daysAgo(today, i);
        revenueLastDays.push({
          day_date: dateKey,
          total_eur: cashMap.get(dateKey) ?? 0,
        });
      }

      // ── Unpaid invoices ──────────────────────────────────────────────
      const unpaidInvoiceCount = unpaidCountResult.count ?? 0;

      // ── Top suppliers this month ─────────────────────────────────────
      const invoiceRows = monthInvoicesResult.data ?? [];
      const supplierMap = new Map<
        string,
        { supplier_name: string; total_amount: number; invoice_count: number }
      >();
      let monthExpenseTotal = 0;

      for (const inv of invoiceRows) {
        monthExpenseTotal += inv.amount_eur;
        const key = inv.supplier_id;
        const existing = supplierMap.get(key);
        if (existing) {
          existing.total_amount += inv.amount_eur;
          existing.invoice_count += 1;
          if (inv.supplier_name) {
            existing.supplier_name = inv.supplier_name;
          }
        } else {
          supplierMap.set(key, {
            supplier_name: inv.supplier_name || "Fournisseur inconnu",
            total_amount: inv.amount_eur,
            invoice_count: 1,
          });
        }
      }

      const topSuppliers: TopSupplier[] = Array.from(supplierMap.values())
        .sort((a, b) => b.total_amount - a.total_amount)
        .slice(0, 5);

      // ── Stock alerts (simplified: count products with min_stock set) ──
      const productsWithMinStock = minStockResult.data?.length ?? 0;
      // STK-ALR-004: This counts products with min_stock configured ("produits surveillés"),
      // NOT actual alerts. Full alert computation happens in the Stock Alerts module.
      const productsMonitored = productsWithMinStock;
      const stockAlertCount = productsMonitored; // deprecated alias

      // ── Active inventory sessions ────────────────────────────────────
      const activeSessions: InventorySessionSummary[] = (activeSessionsResult.data ?? []).map(
        (s) => ({
          id: s.id,
          status: s.status,
          started_at: s.started_at,
          completed_at: s.completed_at,
          counted_products: s.counted_products,
          total_products: s.total_products,
          storage_zone_id: s.storage_zone_id,
        })
      );

      return {
        todayRevenue,
        revenueLastDays,
        unpaidInvoiceCount,
        monthExpenseTotal,
        topSuppliers,
        stockAlertCount,
        productsMonitored,
        productsWithMinStock,
        activeSessions,
      };
    },
  });
}
