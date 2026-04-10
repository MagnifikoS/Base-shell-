/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useEstimatedStock — Real-time stock via StockEngine (snapshot + events)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Loads zone_stock_snapshots → inventory_lines → stock_events
 * Runs getEstimatedStockBatch per zone.
 * Returns Map<product_id, EstimatedStockOutcome>.
 * NEVER writes to DB. NEVER modifies inventory_lines.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useUnits } from "@/hooks/useUnits";
import {
  getEstimatedStockBatch,
  type BatchStockInput,
  type UnitFamilyResolver,
} from "@/modules/stockLedger";
import type { EstimatedStockOutcome } from "@/modules/stockLedger";

export function useEstimatedStock() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { units: dbUnits } = useUnits();

  const STOCK_EVENTS_LIMIT = 10_000;
  const queryKey = ["estimated-stock", estId];

  const { data, isLoading, error, isError } = useQuery({
    queryKey,
    queryFn: async (): Promise<Map<string, EstimatedStockOutcome>> => {
      if (!estId) return new Map();

      // 1. Load all non-archived products (IDs + zone only — NO fallback fields)
      const { data: products, error: prodErr } = await supabase
        .from("products_v2")
        .select("id, storage_zone_id")
        .eq("establishment_id", estId)
        .is("archived_at", null);
      if (prodErr) throw prodErr;
      if (!products?.length) return new Map();

      // 2. Load active snapshots per zone
      const { data: snapshots } = await supabase
        .from("zone_stock_snapshots")
        .select("id, storage_zone_id, snapshot_version_id")
        .eq("establishment_id", estId);

      const snapshotByZone = new Map((snapshots ?? []).map((s) => [s.storage_zone_id, s]));

      // 3. Group products by zone
      const productsByZone = new Map<string, string[]>();
      for (const p of products) {
        if (!p.storage_zone_id) continue;
        const arr = productsByZone.get(p.storage_zone_id) ?? [];
        arr.push(p.id);
        productsByZone.set(p.storage_zone_id, arr);
      }

      // 4. Build unit resolver
      const unitResolver: UnitFamilyResolver = {
        getFamily: (unitId: string) => dbUnits.find((u) => u.id === unitId)?.family ?? null,
        getLabel: (unitId: string) => {
          const u = dbUnits.find((x) => x.id === unitId);
          return u ? `${u.name} (${u.abbreviation})` : null;
        },
      };

      const allResults = new Map<string, EstimatedStockOutcome>();

      // 5. Process each zone
      for (const [zoneId, productIds] of productsByZone) {
        const snapshot = snapshotByZone.get(zoneId);
        if (!snapshot) {
          // No snapshot → error for all products in zone
          for (const pid of productIds) {
            allResults.set(pid, {
              ok: false,
              error: {
                code: "NO_ACTIVE_SNAPSHOT",
                message: "Aucun inventaire de référence pour cette zone.",
                product_id: pid,
                storage_zone_id: zoneId,
              },
            });
          }
          continue;
        }

        // Load inventory_lines for snapshot session
        const { data: invLines } = await supabase
          .from("inventory_lines")
          .select("product_id, quantity, unit_id")
          .eq("session_id", snapshot.snapshot_version_id)
          .in("product_id", productIds);

        const linesByProduct = new Map((invLines ?? []).map((l) => [l.product_id, l]));

        // Load stock_events for this zone + snapshot (P0: explicit limit to prevent silent truncation)
        const { data: events } = await supabase
          .from("stock_events")
          .select("product_id, delta_quantity_canonical, canonical_unit_id, canonical_family")
          .eq("storage_zone_id", zoneId)
          .eq("snapshot_version_id", snapshot.snapshot_version_id)
          .limit(STOCK_EVENTS_LIMIT);

        if (events && events.length >= STOCK_EVENTS_LIMIT) {
          console.warn(
            `[EstimatedStock] ⚠️ TRUNCATION RISK: zone=${zoneId.slice(0, 8)} returned ${events.length} events (limit=${STOCK_EVENTS_LIMIT}). Stock values may be inaccurate.`
          );
        }

        const eventsByProduct = new Map<string, typeof events>();
        for (const evt of events ?? []) {
          const arr = eventsByProduct.get(evt.product_id) ?? [];
          arr.push(evt);
          eventsByProduct.set(evt.product_id, arr);
        }

        // Batch compute — NO synthetic fallback lines (SSOT: DB only)
        const batchInput: BatchStockInput[] = productIds.map((pid) => ({
          product_id: pid,
          snapshotLine: linesByProduct.get(pid) ?? null,
          events: eventsByProduct.get(pid) ?? [],
        }));

        const results = getEstimatedStockBatch(
          zoneId,
          snapshot.snapshot_version_id,
          batchInput,
          unitResolver
        );

        if (import.meta.env.DEV) {
          for (const [pid, outcome] of results) {
            if (outcome.ok) {
              if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.debug(
                  `[EstimatedStock] pid=${pid.slice(0, 8)} zone=${zoneId.slice(0, 8)} snapshot_version=${snapshot.snapshot_version_id.slice(0, 8)} snapshotQty=${outcome.data.snapshot_quantity} eventsDelta=${outcome.data.events_delta} eventsCount=${outcome.data.events_count} → estimated=${outcome.data.estimated_quantity} ${outcome.data.canonical_label}`
                );
              }
            } else {
              const err = (outcome as { ok: false; error: { code: string; message: string } })
                .error;
              if (import.meta.env.DEV) {
                console.warn(
                  `[EstimatedStock] pid=${pid.slice(0, 8)} zone=${zoneId.slice(0, 8)} ERROR: ${err.code} — ${err.message}`
                );
              }
            }
          }
        }

        for (const [pid, outcome] of results) {
          allResults.set(pid, outcome);
        }
      }

      return allResults;
    },
    enabled: !!estId && dbUnits.length > 0,
    staleTime: 30_000, // PH6-P2: reduce refetch on navigation (invalidations still work)
  });

  return {
    estimatedStock: data ?? new Map<string, EstimatedStockOutcome>(),
    isLoading,
    error,
    isError,
    queryKey,
  };
}
