/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HOOK — Historique des prix d'un produit (brain_events)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lecture seule, agrégation UI-only pour drill-down produit.
 * Filtre automatique des events liés à des factures supprimées (voided).
 *
 * ROLLBACK: Supprimer ce fichier — aucun autre module impacté.
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { THE_BRAIN_DISABLED, BRAIN_SUBJECTS, brainDb } from "@/modules/theBrain";
import { fetchVoidedInvoiceIds } from "../utils/fetchVoidedInvoiceIds";

interface PriceEvolutionEvent {
  id: string;
  created_at: string;
  context: {
    invoice_id?: string;
    product_id?: string;
    supplier_id?: string;
    year_month?: string;
    unit_price?: number;
    reference_price?: number | null;
    unit?: string | null;
  } | null;
}

interface _VoidedInvoiceEvent {
  context: {
    invoice_id?: string;
  } | null;
}

/**
 * Résumé mensuel des prix pour un produit donné
 */
export interface MonthlyPriceSummary {
  yearMonth: string;
  firstPrice: number;
  lastPrice: number;
  minPrice: number;
  maxPrice: number;
  observationsCount: number;
}

export interface ProductPriceHistoryResult {
  isAvailable: boolean;
  productId: string | null;
  months: MonthlyPriceSummary[];
}

// fetchVoidedInvoiceIds is now shared — imported from utils

/**
 * Hook pour récupérer l'historique des prix d'un produit spécifique
 * Agrège par mois (year_month) les observations price_evolution
 */
export function useProductPriceHistory(productId: string | null) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["product-price-history", establishmentId, productId],
    queryFn: async (): Promise<ProductPriceHistoryResult> => {
      if (!establishmentId || !productId || THE_BRAIN_DISABLED) {
        return {
          isAvailable: false,
          productId: null,
          months: [],
        };
      }

      // Fetch voided invoice IDs and price evolution events in parallel
      const [voidedIds, eventsResult] = await Promise.all([
        fetchVoidedInvoiceIds(establishmentId),
        brainDb
          .from("brain_events")
          .select("id, created_at, context")
          .eq("establishment_id", establishmentId)
          .eq("subject", BRAIN_SUBJECTS.PRICE_EVOLUTION)
          .eq("action", "observed")
          .order("created_at", { ascending: true }),
      ]);

      if (eventsResult.error) {
        if (import.meta.env.DEV)
          console.error("[useProductPriceHistory] Error:", eventsResult.error);
        return {
          isAvailable: false,
          productId,
          months: [],
        };
      }

      const allEvents = (eventsResult.data ?? []) as unknown as PriceEvolutionEvent[];

      // Filtrer pour ce produit uniquement, en excluant les factures voided
      const productEvents = allEvents.filter((e) => {
        if (e.context?.product_id !== productId) return false;

        // Si l'event a un invoice_id et qu'il est voided, l'exclure
        const invoiceId = e.context?.invoice_id;
        if (invoiceId && voidedIds.has(invoiceId)) return false;

        return true;
      });

      if (productEvents.length === 0) {
        return {
          isAvailable: false,
          productId,
          months: [],
        };
      }

      // Agrégation UI-only par year_month
      const monthMap = new Map<string, number[]>();

      for (const event of productEvents) {
        const ctx = event.context;
        if (!ctx?.year_month || typeof ctx.unit_price !== "number") continue;

        const ym = ctx.year_month;
        if (!monthMap.has(ym)) {
          monthMap.set(ym, []);
        }
        monthMap.get(ym)!.push(ctx.unit_price);
      }

      // Construire les résumés mensuels
      const months: MonthlyPriceSummary[] = [];

      for (const [yearMonth, prices] of monthMap) {
        if (prices.length === 0) continue;

        months.push({
          yearMonth,
          firstPrice: prices[0],
          lastPrice: prices[prices.length - 1],
          minPrice: Math.min(...prices),
          maxPrice: Math.max(...prices),
          observationsCount: prices.length,
        });
      }

      // Trier par mois décroissant (plus récent en premier)
      months.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

      return {
        isAvailable: true,
        productId,
        months,
      };
    },
    enabled: !!establishmentId && !!productId && !THE_BRAIN_DISABLED,
    staleTime: 10 * 60 * 1000, // PERF-10: Static data — price history rarely changes
  });
}
