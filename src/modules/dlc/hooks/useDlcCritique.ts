/**
 * DLC V1 — Hook to fetch all DLC records for the active establishment.
 * Used by DlcCritiquePage for surveillance view.
 *
 * USES CENTRALIZED THRESHOLD RESOLUTION:
 * resolveDlcWarningDays() from dlcCompute.ts (Product > Category > Establishment > Fallback)
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { computeDlcStatus, dlcUrgencyComparator, resolveDlcWarningDays } from "../lib/dlcCompute";
import { useDlcAlertSettings } from "./useDlcAlertSettings";
import type { DlcStatus } from "../types";

export interface DlcCritiqueItem {
  id: string;
  commande_line_id: string;
  product_id: string;
  product_name: string;
  dlc_date: string;
  quantity_received: number;
  canonical_unit_id: string;
  unit_label: string | null;
  warning_days: number; // resolved effective warning days
  status: DlcStatus;
  created_at: string;
}

export function useDlcCritique() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;
  const { defaultWarningDays, categoryThresholds } = useDlcAlertSettings();

  const query = useQuery({
    queryKey: ["dlc", "critique", estId, defaultWarningDays, JSON.stringify(categoryThresholds)],
    queryFn: async (): Promise<DlcCritiqueItem[]> => {
      if (!estId) return [];

      // Fetch all DLC records for this establishment
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dlcRows, error: dlcError } = await (supabase as any)
        .from("reception_lot_dlc")
        .select("id, commande_line_id, product_id, dlc_date, quantity_received, canonical_unit_id, created_at")
        .eq("establishment_id", estId)
        .is("dismissed_at", null)
        .order("dlc_date", { ascending: true });

      if (dlcError) throw new Error(dlcError.message);
      if (!dlcRows || dlcRows.length === 0) return [];

      // Fetch product names + warning days + category_id
      const productIds = [...new Set((dlcRows as { product_id: string }[]).map((r) => r.product_id))];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: products } = await (supabase as any)
        .from("products_v2")
        .select("id, nom_produit, dlc_warning_days, category_id")
        .in("id", productIds);

      const productMap = new Map<string, { name: string; warningDays: number | null; categoryId: string | null }>();
      if (products) {
        for (const p of products as { id: string; nom_produit: string; dlc_warning_days: number | null; category_id: string | null }[]) {
          productMap.set(p.id, { name: p.nom_produit, warningDays: p.dlc_warning_days, categoryId: p.category_id });
        }
      }

      // Fetch unit labels
      const unitIds = [...new Set((dlcRows as { canonical_unit_id: string }[]).map((r) => r.canonical_unit_id))];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: units } = await (supabase as any)
        .from("measurement_units")
        .select("id, abbreviation, name")
        .in("id", unitIds);

      const unitMap = new Map<string, string>();
      if (units) {
        for (const u of units as { id: string; abbreviation: string | null; name: string }[]) {
          unitMap.set(u.id, u.abbreviation ?? u.name);
        }
      }

      // Build items with computed status using centralized resolution
      const items: DlcCritiqueItem[] = (dlcRows as {
        id: string;
        commande_line_id: string;
        product_id: string;
        dlc_date: string;
        quantity_received: number;
        canonical_unit_id: string;
        created_at: string;
      }[]).map((row) => {
        const product = productMap.get(row.product_id);
        // Centralized threshold resolution
        const resolvedDays = resolveDlcWarningDays({
          productWarningDays: product?.warningDays,
          categoryId: product?.categoryId,
          categoryThresholds,
          establishmentDefaultDays: defaultWarningDays,
        });
        return {
          id: row.id,
          commande_line_id: row.commande_line_id,
          product_id: row.product_id,
          product_name: product?.name ?? "Produit inconnu",
          dlc_date: row.dlc_date,
          quantity_received: row.quantity_received,
          canonical_unit_id: row.canonical_unit_id,
          unit_label: unitMap.get(row.canonical_unit_id) ?? null,
          warning_days: resolvedDays,
          status: computeDlcStatus(row.dlc_date, resolvedDays),
          created_at: row.created_at,
        };
      });

      // Sort: expired first, then warning, then ok — most urgent first
      items.sort((a, b) =>
        dlcUrgencyComparator(
          { dlcDate: a.dlc_date, warningDays: a.warning_days },
          { dlcDate: b.dlc_date, warningDays: b.warning_days }
        )
      );

      return items;
    },
    enabled: !!estId,
    staleTime: 60_000,
  });

  const criticalItems = (query.data ?? []).filter((i) => i.status !== "ok");
  const expiredCount = criticalItems.filter((i) => i.status === "expired").length;
  const warningCount = criticalItems.filter((i) => i.status === "warning").length;

  return {
    items: query.data ?? [],
    criticalItems,
    expiredCount,
    warningCount,
    totalCritical: criticalItems.length,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
