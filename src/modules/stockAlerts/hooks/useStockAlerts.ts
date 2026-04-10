/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useStockAlerts — Fetches products with min_stock, computes alerts
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RULES:
 * - Loads products with min_stock_quantity_canonical from DB
 * - Loads active snapshots + inventory_lines + stock_events per zone
 * - Uses StockEngine batch to compute estimated stock
 * - Compares estimated vs min_stock → generates alerts
 * - NEVER stores stock in DB
 * - NEVER computes in UI — delegates to StockEngine
 *
 * MULTI-SUPPLIER:
 * - Stock is always product-level, not supplier-level
 * - all_suppliers includes primary supplier + all suppliers from invoice history
 * - Supplier filter matches products that have ANY matching supplier
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

export type AlertLevel = "rupture" | "warning" | "ok" | "error";

export interface SupplierInfo {
  id: string;
  name: string;
}

export interface StockAlertItem {
  product_id: string;
  product_name: string;
  storage_zone_id: string | null;
  storage_zone_name: string | null;
  /** Primary supplier (from products_v2.supplier_id) */
  supplier_id: string | null;
  supplier_name: string | null;
  /** All known suppliers for this product (primary + invoice history) */
  all_suppliers: SupplierInfo[];
  category: string | null;
  category_id: string | null;
  min_stock_canonical: number | null;
  min_stock_unit_id: string | null;
  estimated_quantity: number | null;
  canonical_unit_id: string | null;
  canonical_label: string | null;
  alert_level: AlertLevel;
  error_message: string | null;
  /** Product config for unit resolution (display conversion) */
  product_unit_config: {
    stock_handling_unit_id: string | null;
    final_unit_id: string | null;
    delivery_unit_id: string | null;
    supplier_billing_unit_id: string | null;
    conditionnement_config: unknown;
  } | null;
}

export function useStockAlerts(zoneFilter: string | null) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { units: dbUnits } = useUnits();

  return useQuery({
    queryKey: ["stock-alerts", estId, zoneFilter],
    queryFn: async (): Promise<StockAlertItem[]> => {
      if (!estId) return [];

      // 1. Load all active (non-archived) products with their zone + supplier + category
      const { data: products, error: prodErr } = await supabase
        .from("products_v2")
        .select(
          "id, nom_produit, storage_zone_id, supplier_id, category_id, min_stock_quantity_canonical, min_stock_unit_id, stock_handling_unit_id, final_unit_id, delivery_unit_id, supplier_billing_unit_id, conditionnement_config, product_categories(name)"
        )
        .eq("establishment_id", estId)
        .is("archived_at", null);
      if (prodErr) throw prodErr;
      if (!products?.length) return [];

      // Filter by zone if needed
      const filtered = zoneFilter
        ? products.filter((p) => p.storage_zone_id === zoneFilter)
        : products;

      // 2. Load zone names
      const { data: zones } = await supabase
        .from("storage_zones")
        .select("id, name")
        .eq("establishment_id", estId);
      const zoneMap = new Map((zones ?? []).map((z) => [z.id, z.name]));

      // 3. Load primary supplier names
      const primarySupplierIds = [
        ...new Set(filtered.map((p) => p.supplier_id).filter(Boolean)),
      ] as string[];
      const supplierMap = new Map<string, string>();
      if (primarySupplierIds.length > 0) {
        const { data: suppliers } = await supabase
          .from("invoice_suppliers")
          .select("id, name")
          .in("id", primarySupplierIds);
        for (const s of suppliers ?? []) {
          supplierMap.set(s.id, s.name);
        }
      }

      // 3b. Discover ALL suppliers per product via invoice_line_items history.
      //     This ensures stock alerts show every supplier that has invoiced a product,
      //     not just the primary supplier_id on products_v2.
      const productIds = filtered.map((p) => p.id);
      const productSupplierMap = new Map<string, Map<string, string>>();

      if (productIds.length > 0) {
        const { data: invoiceLinks } = await supabase
          .from("invoice_line_items")
          .select("product_id, supplier_id")
          .eq("establishment_id", estId)
          .in("product_id", productIds)
          .limit(10_000);

        if (invoiceLinks?.length) {
          // Collect unique supplier IDs from invoice lines
          const invoiceSupplierIds = [
            ...new Set(invoiceLinks.map((l) => l.supplier_id).filter(Boolean)),
          ] as string[];

          // Fetch names for any supplier not already in the primary map
          const missingSupplierIds = invoiceSupplierIds.filter((id) => !supplierMap.has(id));
          if (missingSupplierIds.length > 0) {
            const { data: extraSuppliers } = await supabase
              .from("invoice_suppliers")
              .select("id, name")
              .in("id", missingSupplierIds);
            for (const s of extraSuppliers ?? []) {
              supplierMap.set(s.id, s.name);
            }
          }

          // Build product -> suppliers map from invoice history
          for (const link of invoiceLinks) {
            if (!link.product_id || !link.supplier_id) continue;
            if (!productSupplierMap.has(link.product_id)) {
              productSupplierMap.set(link.product_id, new Map());
            }
            const name = supplierMap.get(link.supplier_id);
            if (name) {
              productSupplierMap.get(link.product_id)!.set(link.supplier_id, name);
            }
          }
        }
      }

      // Helper: build all_suppliers array for a product (primary + invoice history)
      const buildAllSuppliers = (
        productId: string,
        primarySupplierId: string | null
      ): SupplierInfo[] => {
        const result = new Map<string, string>();
        // Add primary supplier first
        if (primarySupplierId) {
          const name = supplierMap.get(primarySupplierId);
          if (name) result.set(primarySupplierId, name);
        }
        // Add all invoice-history suppliers
        const invoiceSuppliers = productSupplierMap.get(productId);
        if (invoiceSuppliers) {
          for (const [id, name] of invoiceSuppliers) {
            if (!result.has(id)) result.set(id, name);
          }
        }
        return Array.from(result, ([id, name]) => ({ id, name }));
      };

      // 4. Load active snapshots — batched by zone IDs (API-PERF-014)
      const allZoneIds = [
        ...new Set(filtered.map((p) => p.storage_zone_id).filter(Boolean)),
      ] as string[];
      const { data: snapshots } =
        allZoneIds.length > 0
          ? await supabase
              .from("zone_stock_snapshots")
              .select("id, storage_zone_id, snapshot_version_id")
              .eq("establishment_id", estId)
              .in("storage_zone_id", allZoneIds)
          : { data: [] as { id: string; storage_zone_id: string; snapshot_version_id: string }[] };

      const snapshotByZone = new Map((snapshots ?? []).map((s) => [s.storage_zone_id, s]));

      // 5. Group products by zone for batch processing
      const productsByZone = new Map<string, typeof filtered>();
      for (const p of filtered) {
        if (!p.storage_zone_id) continue;
        const existing = productsByZone.get(p.storage_zone_id) ?? [];
        existing.push(p);
        productsByZone.set(p.storage_zone_id, existing);
      }

      // STK-ALR-006: Products with min_stock but no zone → show as error
      const unzonedProducts = filtered.filter(
        (p) => !p.storage_zone_id && p.min_stock_quantity_canonical != null
      );

      // 6. Build unit resolver
      const unitResolver: UnitFamilyResolver = {
        getFamily: (unitId: string) => dbUnits.find((u) => u.id === unitId)?.family ?? null,
        getLabel: (unitId: string) => {
          const u = dbUnits.find((x) => x.id === unitId);
          return u ? `${u.name} (${u.abbreviation})` : null;
        },
      };

      const buildUnitConfig = (p: (typeof filtered)[number]) => ({
        stock_handling_unit_id: p.stock_handling_unit_id,
        final_unit_id: p.final_unit_id,
        delivery_unit_id: p.delivery_unit_id,
        supplier_billing_unit_id: p.supplier_billing_unit_id,
        conditionnement_config: p.conditionnement_config,
      });

      // 7. Batch-fetch inventory lines and stock events for ALL zones (API-PERF-014: fix N+1)
      const allSnapshotVersionIds: string[] = [];
      const allZoneIdsWithSnapshot: string[] = [];
      for (const [zoneId] of productsByZone) {
        const snapshot = snapshotByZone.get(zoneId);
        if (snapshot) {
          allSnapshotVersionIds.push(snapshot.snapshot_version_id);
          allZoneIdsWithSnapshot.push(zoneId);
        }
      }

      // Batch fetch inventory lines for ALL snapshots
      const allInvLines =
        allSnapshotVersionIds.length > 0
          ? ((
              await supabase
                .from("inventory_lines")
                .select("session_id, product_id, quantity, unit_id")
                .in("session_id", allSnapshotVersionIds)
            ).data ?? [])
          : [];

      // Batch fetch stock events for ALL zones with snapshots
      // BUG-03 FIX: filter by snapshot_version_id to exclude events from previous inventory periods
      // P0 FIX (audit cas 4): add .limit(10_000) to prevent silent truncation at Supabase default 1000
      const allEvents =
        allSnapshotVersionIds.length > 0
          ? ((
              await supabase
                .from("stock_events")
                .select(
                  "storage_zone_id, product_id, delta_quantity_canonical, canonical_unit_id, canonical_family, snapshot_version_id"
                )
                .in("storage_zone_id", allZoneIdsWithSnapshot)
                .in("snapshot_version_id", allSnapshotVersionIds)
                .limit(10_000)
            ).data ?? [])
          : [];

      // Index by session_id -> product_id for inv lines
      const invLinesBySession = new Map<string, Map<string, (typeof allInvLines)[number]>>();
      for (const l of allInvLines) {
        if (!invLinesBySession.has(l.session_id)) invLinesBySession.set(l.session_id, new Map());
        invLinesBySession.get(l.session_id)!.set(l.product_id, l);
      }

      // Index by zone_id -> product_id for events
      const eventsByZone = new Map<string, Map<string, typeof allEvents>>();
      for (const evt of allEvents) {
        if (!eventsByZone.has(evt.storage_zone_id))
          eventsByZone.set(evt.storage_zone_id, new Map());
        const zoneEvents = eventsByZone.get(evt.storage_zone_id)!;
        const arr = zoneEvents.get(evt.product_id) ?? [];
        arr.push(evt);
        zoneEvents.set(evt.product_id, arr);
      }

      // 8. Process each zone using pre-fetched data
      const alerts: StockAlertItem[] = [];
      const getCatName = (p: (typeof products)[number]) =>
        (p.product_categories as { name: string } | null)?.name ?? null;

      for (const [zoneId, zoneProducts] of productsByZone) {
        const snapshot = snapshotByZone.get(zoneId);
        if (!snapshot) {
          for (const p of zoneProducts) {
            alerts.push({
              product_id: p.id,
              product_name: p.nom_produit,
              storage_zone_id: zoneId,
              storage_zone_name: zoneMap.get(zoneId) ?? null,
              supplier_id: p.supplier_id,
              supplier_name: p.supplier_id ? (supplierMap.get(p.supplier_id) ?? null) : null,
              all_suppliers: buildAllSuppliers(p.id, p.supplier_id),
              category: getCatName(p),
              category_id: p.category_id,
              min_stock_canonical: p.min_stock_quantity_canonical as number | null,
              min_stock_unit_id: p.min_stock_unit_id,
              estimated_quantity: null,
              canonical_unit_id: null,
              canonical_label: null,
              alert_level: "error",
              error_message: "Aucun inventaire de référence pour cette zone.",
              product_unit_config: buildUnitConfig(p),
            });
          }
          continue;
        }

        const sessionLines = invLinesBySession.get(snapshot.snapshot_version_id) ?? new Map();
        const zoneEventMap = eventsByZone.get(zoneId) ?? new Map();

        // Batch compute
        const batchInput: BatchStockInput[] = zoneProducts.map((p) => ({
          product_id: p.id,
          snapshotLine: sessionLines.get(p.id) ?? null,
          events: zoneEventMap.get(p.id) ?? [],
        }));

        const results = getEstimatedStockBatch(
          zoneId,
          snapshot.snapshot_version_id,
          batchInput,
          unitResolver
        );

        // Build alerts
        for (const p of zoneProducts) {
          const outcome = results.get(p.id);
          const minStock = p.min_stock_quantity_canonical as number | null;

          if (!outcome || !outcome.ok) {
            const errMsg =
              outcome && !outcome.ok
                ? (outcome as { ok: false; error: { message: string } }).error.message
                : "Erreur StockEngine inconnue.";
            alerts.push({
              product_id: p.id,
              product_name: p.nom_produit,
              storage_zone_id: zoneId,
              storage_zone_name: zoneMap.get(zoneId) ?? null,
              supplier_id: p.supplier_id,
              supplier_name: p.supplier_id ? (supplierMap.get(p.supplier_id) ?? null) : null,
              all_suppliers: buildAllSuppliers(p.id, p.supplier_id),
              category: getCatName(p),
              category_id: p.category_id,
              min_stock_canonical: minStock,
              min_stock_unit_id: p.min_stock_unit_id,
              estimated_quantity: null,
              canonical_unit_id: null,
              canonical_label: null,
              alert_level: "error",
              error_message: errMsg,
              product_unit_config: buildUnitConfig(p),
            });
            continue;
          }

          const est = outcome.data.estimated_quantity;
          let level: AlertLevel = "ok";
          if (est <= 0) {
            level = "rupture";
          } else if (minStock != null && est < minStock) {
            level = "warning";
          }

          alerts.push({
            product_id: p.id,
            product_name: p.nom_produit,
            storage_zone_id: zoneId,
            storage_zone_name: zoneMap.get(zoneId) ?? null,
            supplier_id: p.supplier_id,
            supplier_name: p.supplier_id ? (supplierMap.get(p.supplier_id) ?? null) : null,
            all_suppliers: buildAllSuppliers(p.id, p.supplier_id),
            category: getCatName(p),
            category_id: p.category_id,
            min_stock_canonical: minStock,
            min_stock_unit_id: p.min_stock_unit_id,
            estimated_quantity: est,
            canonical_unit_id: outcome.data.canonical_unit_id,
            canonical_label: outcome.data.canonical_label,
            alert_level: level,
            error_message: null,
            product_unit_config: buildUnitConfig(p),
          });
        }
      }

      // STK-ALR-006: Add unzoned products with min_stock as errors
      for (const p of unzonedProducts) {
        alerts.push({
          product_id: p.id,
          product_name: p.nom_produit,
          storage_zone_id: null,
          storage_zone_name: null,
          supplier_id: p.supplier_id,
          supplier_name: p.supplier_id ? (supplierMap.get(p.supplier_id) ?? null) : null,
          all_suppliers: buildAllSuppliers(p.id, p.supplier_id),
          category: getCatName(p),
          category_id: p.category_id,
          min_stock_canonical: p.min_stock_quantity_canonical as number | null,
          min_stock_unit_id: p.min_stock_unit_id,
          estimated_quantity: null,
          canonical_unit_id: null,
          canonical_label: null,
          alert_level: "error",
          error_message: "Produit avec seuil min configuré mais aucune zone de stockage assignée.",
          product_unit_config: buildUnitConfig(p),
        });
      }

      // Sort: rupture first, then warning, then error, then ok
      const levelOrder: Record<AlertLevel, number> = {
        rupture: 0,
        warning: 1,
        error: 2,
        ok: 3,
      };
      alerts.sort((a, b) => levelOrder[a.alert_level] - levelOrder[b.alert_level]);

      return alerts;
    },
    enabled: !!estId && dbUnits.length > 0,
    staleTime: 30_000,
  });
}
