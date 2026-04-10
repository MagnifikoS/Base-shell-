/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Supplier Matching Service (Lecture seule)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Service pour lire et agréger les événements supplier_matching depuis brain_events.
 * LECTURE SEULE — Aucune écriture.
 * Agrégation UI-only depuis les événements bruts.
 */

import { supabase } from "@/integrations/supabase/client";
import { THE_BRAIN_DISABLED } from "../constants";
import type { SupplierMatchingRuleDisplay, SupplierMatchingStatus } from "../types";
import { brainDb } from "./brainDb";

interface SupplierMatchingEvent {
  id: string;
  action: string;
  context: {
    supplier_id?: string;
    [key: string]: unknown;
  };
  created_at: string;
}

/**
 * Calcule le statut basé sur le nombre de corrections (UI-only)
 */
function computeSupplierStatus(corrections: number): SupplierMatchingStatus {
  return corrections === 0 ? "stable" : "monitoring";
}

/**
 * Récupère et agrège les événements supplier_matching depuis brain_events
 *
 * LECTURE SEULE — Aucune écriture
 *
 * Agrégation:
 * - action = "confirmed" → +1 confirmation
 * - action = "corrected" → +1 correction
 * - Dernière utilisation = max(created_at) par supplier
 *
 * Filtrage:
 * - Exclure les fournisseurs archivés (invoice_suppliers.archived_at IS NOT NULL)
 */
export async function getSupplierMatchingRules(
  establishmentId: string
): Promise<SupplierMatchingRuleDisplay[]> {
  if (THE_BRAIN_DISABLED) return [];

  try {
    // Récupérer les événements supplier_matching
    const { data: events, error: eventsError } = await brainDb
      .from("brain_events")
      .select("id, action, context, created_at")
      .eq("establishment_id", establishmentId)
      .eq("subject", "supplier_matching")
      .order("created_at", { ascending: false });

    if (eventsError || !events) {
      if (import.meta.env.DEV)
        console.error("[THE BRAIN] getSupplierMatchingRules events error:", eventsError);
      return [];
    }

    const typedEvents = events as unknown as SupplierMatchingEvent[];

    if (typedEvents.length === 0) return [];

    // Agréger par supplier_id
    const aggregation = new Map<
      string,
      {
        confirmations: number;
        corrections: number;
        lastUsedAt: string;
      }
    >();

    for (const event of typedEvents) {
      const supplierId = event.context?.supplier_id;
      if (!supplierId || typeof supplierId !== "string") continue;

      const existing = aggregation.get(supplierId);
      if (!existing) {
        aggregation.set(supplierId, {
          confirmations: event.action === "confirmed" ? 1 : 0,
          corrections: event.action === "corrected" ? 1 : 0,
          lastUsedAt: event.created_at,
        });
      } else {
        if (event.action === "confirmed") existing.confirmations++;
        if (event.action === "corrected") existing.corrections++;
        // lastUsedAt reste le premier (plus récent car ordonné DESC)
      }
    }

    if (aggregation.size === 0) return [];

    // Récupérer les noms des fournisseurs (batch)
    const supplierIds = Array.from(aggregation.keys());

    const { data: suppliers, error: suppliersError } = await supabase
      .from("invoice_suppliers")
      .select("id, name, archived_at")
      .in("id", supplierIds);

    if (suppliersError) {
      if (import.meta.env.DEV)
        console.error("[THE BRAIN] getSupplierMatchingRules suppliers error:", suppliersError);
      return [];
    }

    // Map fournisseurs par ID (exclure archivés)
    const supplierMap = new Map<string, string>();
    for (const s of suppliers ?? []) {
      if (s.archived_at === null) {
        supplierMap.set(s.id, s.name);
      }
    }

    // Construire le résultat final
    const result: SupplierMatchingRuleDisplay[] = [];
    for (const [supplierId, stats] of aggregation) {
      const supplierName = supplierMap.get(supplierId);

      // Exclure si fournisseur archivé ou inexistant
      if (!supplierName) continue;

      result.push({
        supplierId,
        supplierName,
        confirmationsCount: stats.confirmations,
        correctionsCount: stats.corrections,
        lastUsedAt: stats.lastUsedAt,
        status: computeSupplierStatus(stats.corrections),
      });
    }

    // Trier par nombre de confirmations (décroissant)
    result.sort((a, b) => b.confirmationsCount - a.confirmationsCount);

    return result;
  } catch (err) {
    if (import.meta.env.DEV) console.error("[THE BRAIN] getSupplierMatchingRules exception:", err);
    return [];
  }
}
