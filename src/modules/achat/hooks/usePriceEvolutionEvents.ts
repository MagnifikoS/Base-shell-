/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HOOK — Lecture des événements price_evolution (brain_events)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lecture seule, agrégation UI-only pour synthèse.
 * Filtre automatique des events liés à des factures supprimées (voided).
 *
 * ROLLBACK: Supprimer ce fichier — aucun autre module impacté.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { THE_BRAIN_DISABLED, BRAIN_SUBJECTS, brainDb } from "@/modules/theBrain";

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


interface ProductPriceSummary {
  productId: string;
  /** Nom produit depuis products_v2 (SSOT) — fallback si non trouvé */
  productName: string;
  /** Unité fournisseur résolue via supplier_billing_unit_id → measurement_units */
  billingUnit: string | null;
  supplierId: string | null;
  minPrice: number;
  maxPrice: number;
  firstPrice: number;
  lastPrice: number;
  observationsCount: number;
  isVariable: boolean;
  trend: "up" | "down" | "stable";
}

export interface PriceEvolutionSynthesis {
  hasData: boolean;
  totalProducts: number;
  stableCount: number;
  variableCount: number;
  topVariables: ProductPriceSummary[];
  topIncreases: ProductPriceSummary[];
  topDecreases: ProductPriceSummary[];
  summaryText: string;
}

/**
 * Génère un texte de synthèse humain (sans %, sans chiffres agressifs)
 */
function generateSummaryText(
  totalProducts: number,
  stableCount: number,
  variableCount: number
): string {
  if (totalProducts === 0) {
    return "Aucune observation de prix sur cette période.";
  }

  const stableRatio = stableCount / totalProducts;

  if (variableCount === 0) {
    return "Les prix sont globalement stables sur la période sélectionnée.";
  }

  if (stableRatio >= 0.8) {
    return "Quelques variations ont été observées sur certains produits, mais la majorité reste stable.";
  }

  if (stableRatio >= 0.5) {
    return "Des variations ont été observées sur plusieurs produits ce mois-ci.";
  }

  return "Plusieurs produits semblent avoir des prix instables (à surveiller).";
}

// fetchVoidedInvoiceIds is now shared — imported from utils
import { fetchVoidedInvoiceIds } from "../utils/fetchVoidedInvoiceIds";

/**
 * Hook pour récupérer et agréger les événements price_evolution
 */
export function usePriceEvolutionEvents(yearMonth: string) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["price-evolution-events", establishmentId, yearMonth],
    queryFn: async (): Promise<PriceEvolutionSynthesis> => {
      if (!establishmentId || THE_BRAIN_DISABLED) {
        return {
          hasData: false,
          totalProducts: 0,
          stableCount: 0,
          variableCount: 0,
          topVariables: [],
          topIncreases: [],
          topDecreases: [],
          summaryText: "",
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
          console.error("[usePriceEvolutionEvents] Error:", eventsResult.error);
        return {
          hasData: false,
          totalProducts: 0,
          stableCount: 0,
          variableCount: 0,
          topVariables: [],
          topIncreases: [],
          topDecreases: [],
          summaryText: "",
        };
      }

      const events = (eventsResult.data ?? []) as unknown as PriceEvolutionEvent[];

      // Filtrer par year_month ET exclure les factures voided
      // Note: Les anciens events sans invoice_id ne sont PAS exclus (non rétroactif)
      const monthEvents = events.filter((e) => {
        if (e.context?.year_month !== yearMonth) return false;

        // Si l'event a un invoice_id et qu'il est voided, l'exclure
        const invoiceId = e.context?.invoice_id;
        if (invoiceId && voidedIds.has(invoiceId)) return false;

        return true;
      });

      if (monthEvents.length === 0) {
        return {
          hasData: false,
          totalProducts: 0,
          stableCount: 0,
          variableCount: 0,
          topVariables: [],
          topIncreases: [],
          topDecreases: [],
          summaryText: "",
        };
      }

      // Agrégation UI-only par product_id
      const productMap = new Map<
        string,
        {
          supplierId: string | null;
          prices: number[];
        }
      >();

      for (const event of monthEvents) {
        const ctx = event.context;
        if (!ctx?.product_id || typeof ctx.unit_price !== "number") continue;

        const key = ctx.product_id;
        if (!productMap.has(key)) {
          productMap.set(key, {
            supplierId: ctx.supplier_id ?? null,
            prices: [],
          });
        }
        productMap.get(key)!.prices.push(ctx.unit_price);
      }

      // Batch lookup vers products_v2 (SSOT) pour nom + unité fournisseur
      const productIds = Array.from(productMap.keys());
      const productsLookup = new Map<string, { name: string; unit: string | null }>();

      if (productIds.length > 0) {
        const { data: productsData } = await supabase
          .from("products_v2")
          .select("id, nom_produit, supplier_billing_unit_id")
          .in("id", productIds);

        if (productsData) {
          // Resolve unit labels via measurement_units
          const unitIds = [...new Set(
            productsData.map((p) => p.supplier_billing_unit_id).filter((id): id is string => id != null)
          )];
          const unitsMap = new Map<string, string>();
          if (unitIds.length > 0) {
            const { data: units } = await supabase
              .from("measurement_units")
              .select("id, abbreviation")
              .in("id", unitIds);
            if (units) {
              for (const u of units) unitsMap.set(u.id, u.abbreviation);
            }
          }

          for (const p of productsData) {
            productsLookup.set(p.id, {
              name: p.nom_produit,
              unit: p.supplier_billing_unit_id ? (unitsMap.get(p.supplier_billing_unit_id) ?? null) : null,
            });
          }
        }
      }

      // Calculer les résumés par produit
      const summaries: ProductPriceSummary[] = [];

      for (const [productId, data] of productMap) {
        const { prices, supplierId } = data;
        if (prices.length === 0) continue;

        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const firstPrice = prices[0];
        const lastPrice = prices[prices.length - 1];

        // Détection simple: variable si min != max OU first != last
        const isVariable = minPrice !== maxPrice || firstPrice !== lastPrice;

        // Trend simple
        let trend: "up" | "down" | "stable" = "stable";
        if (lastPrice > firstPrice) trend = "up";
        else if (lastPrice < firstPrice) trend = "down";

        // Enrichissement depuis SSOT products_v2
        const productInfo = productsLookup.get(productId);

        summaries.push({
          productId,
          productName: productInfo?.name ?? "Produit inconnu",
          billingUnit: productInfo?.unit ?? null,
          supplierId,
          minPrice,
          maxPrice,
          firstPrice,
          lastPrice,
          observationsCount: prices.length,
          isVariable,
          trend,
        });
      }

      const stableCount = summaries.filter((s) => !s.isVariable).length;
      const variableCount = summaries.filter((s) => s.isVariable).length;

      // Top 5 variables (par nombre d'observations)
      const topVariables = summaries
        .filter((s) => s.isVariable)
        .sort((a, b) => b.observationsCount - a.observationsCount)
        .slice(0, 5);

      // Top 5 hausses (uniquement ceux avec trend = "up")
      const topIncreases = summaries
        .filter((s) => s.trend === "up")
        .sort((a, b) => b.lastPrice - b.firstPrice - (a.lastPrice - a.firstPrice))
        .slice(0, 5);

      // Top 5 baisses (uniquement ceux avec trend = "down")
      const topDecreases = summaries
        .filter((s) => s.trend === "down")
        .sort((a, b) => a.lastPrice - a.firstPrice - (b.lastPrice - b.firstPrice))
        .slice(0, 5);

      return {
        hasData: true,
        totalProducts: summaries.length,
        stableCount,
        variableCount,
        topVariables,
        topIncreases,
        topDecreases,
        summaryText: generateSummaryText(summaries.length, stableCount, variableCount),
      };
    },
    enabled: !!establishmentId && !THE_BRAIN_DISABLED,
    staleTime: 10 * 60 * 1000, // PERF-10: Static data — price history rarely changes
  });
}
