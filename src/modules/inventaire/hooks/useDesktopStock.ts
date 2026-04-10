/**
 * Hook to fetch products V2 combined with their latest inventory line quantity
 * (from the latest COMPLETED session of their respective zone)
 *
 * Queries are batched into 3 parallel rounds to minimize waterfall latency:
 *   Batch 1 (parallel): products_v2 + zone_stock_snapshots + active inventory_sessions
 *   Batch 2 (depends on batch 1): inventory_sessions by snapshotSessionIds
 *   Batch 3 (parallel, depends on batch 2): completed inventory_lines + active inventory_lines + inventory_zone_products
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { updateLineQuantity, createInventoryLine } from "../services/inventoryLineService";
import { toast } from "sonner";

export interface DesktopProductStock {
  product_id: string;
  nom_produit: string;
  /** SSOT: UUID → product_categories.id */
  category_id: string | null;
  /** Nom catégorie (via jointure product_categories) */
  category_name: string | null;
  supplier_id: string;
  supplier_billing_unit_id: string | null;
  final_unit_id: string | null;
  stock_handling_unit_id: string | null;
  delivery_unit_id: string | null;
  conditionnement_config: import("@/modules/produitsV2/types").ConditioningConfig | null;
  storage_zone_id: string | null;
  storage_zone_name: string | null;
  inventory_display_unit_id: string | null;
  /** Preferred display unit from inventory_zone_products (per zone) */
  preferred_display_unit_id: string | null;
  last_line_id: string | null;
  last_quantity: number | null;
  last_unit_id: string | null;
  last_session_date: string | null;
  latest_zone_session_id: string | null;
  /** Session en cours détectée pour cette zone (alerte incohérence) */
  active_session_id: string | null;
  active_session_started_at: string | null;
  /** Données de la session en cours (si pas de session terminée) */
  active_line_id: string | null;
  active_quantity: number | null;
  active_unit_id: string | null;
  /** Min stock fields from products_v2 (SSOT) */
  min_stock_quantity_canonical: number | null;
  min_stock_unit_id: string | null;
}

export function useDesktopStock() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const queryClient = useQueryClient();

  const queryKey = ["desktop-stock", estId];

  const {
    data: stock = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: async (): Promise<DesktopProductStock[]> => {
      if (!estId) return [];

      // ─── Batch 1 (parallel): products_v2 + zone_stock_snapshots + active sessions ───
      const [productsResult, snapshotsResult, activeSessionsResult] = await Promise.all([
        // 1a. Fetch all products V2 with zone name
        supabase
          .from("products_v2")
          .select(
            `
            id, 
            nom_produit, 
            category_id,
            supplier_id, 
            supplier_billing_unit_id,
            final_unit_id,
            stock_handling_unit_id,
            delivery_unit_id,
            conditionnement_config,
            storage_zone_id,
            inventory_display_unit_id,
            min_stock_quantity_canonical,
            min_stock_unit_id,
            storage_zones ( name ),
            product_categories ( name )
          `
          )
          .eq("establishment_id", estId)
          .is("archived_at", null),

        // 1b. P0-5: Use zone_stock_snapshots as SSOT (same source as StockEngine)
        supabase
          .from("zone_stock_snapshots")
          .select("snapshot_version_id, storage_zone_id")
          .eq("establishment_id", estId),

        // 1c. Fetch ACTIVE sessions (en_cours / en_pause) per zone for warning
        supabase
          .from("inventory_sessions")
          .select("id, storage_zone_id, started_at")
          .eq("establishment_id", estId)
          .in("status", ["en_cours", "en_pause"])
          .order("started_at", { ascending: false })
          .order("id", { ascending: false }),
      ]);

      if (productsResult.error) throw productsResult.error;
      if (snapshotsResult.error) throw snapshotsResult.error;
      if (activeSessionsResult.error) throw activeSessionsResult.error;

      const products = productsResult.data;
      const snapshots = snapshotsResult.data;
      const activeSessions = activeSessionsResult.data;

      // Build active session map
      const activeSessionByZone = new Map<string, { id: string; started_at: string }>();
      activeSessions?.forEach((s) => {
        if (!activeSessionByZone.has(s.storage_zone_id)) {
          activeSessionByZone.set(s.storage_zone_id, { id: s.id, started_at: s.started_at });
        }
      });

      // ─── Batch 2 (depends on batch 1): inventory_sessions by snapshotSessionIds ───
      const latestSessionByZone = new Map<string, { id: string; completed_at: string }>();
      const snapshotSessionIds = (snapshots ?? []).map((s) => s.snapshot_version_id);

      if (snapshotSessionIds.length > 0) {
        const { data: sessions, error: sessError } = await supabase
          .from("inventory_sessions")
          .select("id, storage_zone_id, completed_at")
          .in("id", snapshotSessionIds);

        if (sessError) throw sessError;

        sessions?.forEach((s) => {
          latestSessionByZone.set(s.storage_zone_id, {
            id: s.id,
            completed_at: s.completed_at || "",
          });
        });
      }

      // ─── Batch 3 (parallel, depends on batch 2): completed lines + active lines + zone products ───
      const relevantSessionIds = Array.from(latestSessionByZone.values()).map((s) => s.id);
      const activeSessionIds = Array.from(activeSessionByZone.values()).map((s) => s.id);

      // Build all batch 3 promises
      const completedLinesPromise =
        relevantSessionIds.length > 0
          ? supabase
              .from("inventory_lines")
              .select("id, product_id, quantity, unit_id, session_id")
              .in("session_id", relevantSessionIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                product_id: string;
                quantity: number | null;
                unit_id: string | null;
                session_id: string;
              }[],
              error: null,
            });

      const activeLinesPromise =
        activeSessionIds.length > 0
          ? supabase
              .from("inventory_lines")
              .select("id, product_id, quantity, unit_id, session_id, counted_at")
              .in("session_id", activeSessionIds)
              .not("counted_at", "is", null)
          : Promise.resolve({
              data: [] as {
                id: string;
                product_id: string;
                quantity: number | null;
                unit_id: string | null;
                session_id: string;
                counted_at: string | null;
              }[],
              error: null,
            });

      const zoneProductsPromise = supabase
        .from("inventory_zone_products")
        .select("product_id, storage_zone_id, preferred_unit_id")
        .eq("establishment_id", estId);

      const [completedLinesResult, activeLinesResult, zoneProductsResult] = await Promise.all([
        completedLinesPromise,
        activeLinesPromise,
        zoneProductsPromise,
      ]);

      if (completedLinesResult.error) throw completedLinesResult.error;
      if (activeLinesResult.error) throw activeLinesResult.error;
      if (zoneProductsResult.error) throw zoneProductsResult.error;

      // Build completed lines map
      const linesMap = new Map<
        string,
        { id: string; quantity: number | null; unit_id: string | null; completed_at: string }
      >();

      if (completedLinesResult.data && completedLinesResult.data.length > 0) {
        // Build reverse map: session_id -> zone_id
        const sessionToZone = new Map<string, string>();
        for (const [zoneId, session] of latestSessionByZone) {
          sessionToZone.set(session.id, zoneId);
        }

        completedLinesResult.data.forEach((l) => {
          const sessionZoneId = sessionToZone.get(l.session_id);
          if (!sessionZoneId) return;

          const latestForZone = latestSessionByZone.get(sessionZoneId);
          if (!latestForZone || latestForZone.id !== l.session_id) return;

          linesMap.set(l.product_id, {
            id: l.id,
            quantity: l.quantity,
            unit_id: l.unit_id,
            completed_at: latestForZone.completed_at || "",
          });
        });
      }

      // Build active lines map
      const activeLinesMap = new Map<
        string,
        { id: string; quantity: number | null; unit_id: string | null }
      >();

      activeLinesResult.data?.forEach((l) => {
        activeLinesMap.set(l.product_id, {
          id: l.id,
          quantity: l.quantity,
          unit_id: l.unit_id,
        });
      });

      // Build preferred unit map
      const preferredUnitMap = new Map<string, string | null>();
      zoneProductsResult.data?.forEach((zp) => {
        // Key = productId:zoneId
        preferredUnitMap.set(`${zp.product_id}:${zp.storage_zone_id}`, zp.preferred_unit_id);
      });

      // ─── Merge ───
      return products.map((p) => {
        const line = linesMap.get(p.id);
        const activeLine = activeLinesMap.get(p.id);
        const zoneId = p.storage_zone_id;
        const latestSession = zoneId ? latestSessionByZone.get(zoneId) : null;
        const activeSession = zoneId ? activeSessionByZone.get(zoneId) : null;
        const zoneName =
          (p as unknown as { storage_zones?: { name?: string } }).storage_zones?.name ?? null;
        const preferredUnit = zoneId ? (preferredUnitMap.get(`${p.id}:${zoneId}`) ?? null) : null;

        const categoryName =
          (p as unknown as { product_categories?: { name?: string } }).product_categories?.name ?? null;

        return {
          product_id: p.id,
          nom_produit: p.nom_produit,
          category_id: (p as unknown as { category_id: string | null }).category_id ?? null,
          category_name: categoryName,
          supplier_id: p.supplier_id,
          supplier_billing_unit_id: p.supplier_billing_unit_id,
          final_unit_id: p.final_unit_id,
          stock_handling_unit_id: p.stock_handling_unit_id,
          delivery_unit_id: p.delivery_unit_id,
          conditionnement_config: p.conditionnement_config as unknown as
            | import("@/modules/produitsV2/types").ConditioningConfig
            | null,
          storage_zone_id: p.storage_zone_id ?? null,
          storage_zone_name: zoneName,
          inventory_display_unit_id: p.inventory_display_unit_id ?? null,
          preferred_display_unit_id: preferredUnit,
          last_line_id: line?.id ?? null,
          last_quantity: line?.quantity ?? null,
          last_unit_id: line?.unit_id ?? null,
          last_session_date: line?.completed_at ?? null,
          latest_zone_session_id: latestSession?.id ?? null,
          active_session_id: activeSession?.id ?? null,
          active_session_started_at: activeSession?.started_at ?? null,
          active_line_id: activeLine?.id ?? null,
          active_quantity: activeLine?.quantity ?? null,
          active_unit_id: activeLine?.unit_id ?? null,
          min_stock_quantity_canonical: p.min_stock_quantity_canonical ?? null,
          min_stock_unit_id: p.min_stock_unit_id ?? null,
        };
      });
    },
    enabled: !!estId,
    staleTime: 30_000, // PH6: avoid refetch on every navigation (heavy query)
  });

  // Mutation to update stock (update or create line) AND sync product unit
  const updateStock = useMutation({
    mutationFn: async (params: {
      lineId: string | null;
      quantity: number;
      unitId: string | null;
      productId: string;
      sessionId: string | null;
      unitLabel?: string | null; // To sync products_v2.supplier_billing_unit
    }) => {
      const promises = [];

      // 1. Inventory Line Update
      if (params.lineId) {
        // Update existing
        promises.push(updateLineQuantity(params.lineId, params.quantity, params.unitId));
      } else {
        // Create new if session available
        if (!params.sessionId) {
          throw new Error("Aucun inventaire terminé disponible pour ce produit (zone)");
        }
        promises.push(
          createInventoryLine({
            sessionId: params.sessionId,
            productId: params.productId,
            quantity: params.quantity,
            unitId: params.unitId,
          })
        );
      }

      // 2. No product unit sync — inventory saves canonical only (SSOT policy)

      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Stock mis à jour");
    },
    onError: (e: Error) => toast.error(e.message || "Erreur lors de la mise à jour"),
  });

  return { stock, isLoading, error, refetch, updateStock };
}
