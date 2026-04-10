/**
 * Fetches products with their conditioning config and input config,
 * enriches them for the config list view.
 *
 * ARCHITECTURE v2: Status is now computed by running the BFS engine
 * per product and validating saved config against engine-derived choices.
 * This eliminates the dual-logic divergence between dialog choices
 * (engine-driven) and validation (formerly heuristic-driven).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type {
  ProductForConfig,
  ProductInputConfigRow,
  InputConfigFilters,
  ProductNature,
  AutoConfigPayload,
} from "../types";
import { resolveUnitNature, classifyProductNature, computeConfigStatusFromChoices } from "../utils/configLogic";
import { buildUnitChoicesFromEngine } from "../utils/buildUnitChoices";
import { resolveProductUnitContext } from "@/core/unitConversion/resolveProductUnitContext";
import type { ConditioningConfig } from "@/modules/shared/conditioningTypes";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";

interface RawProduct {
  id: string;
  nom_produit: string;
  final_unit_id: string | null;
  supplier_billing_unit_id: string | null;
  delivery_unit_id: string | null;
  stock_handling_unit_id: string | null;
  conditionnement_config: Record<string, unknown> | null;
}

/** Shape of the equivalence object inside conditionnement_config */
interface EquivalenceConfig {
  sourceQuantity?: number;
  sourceUnitId?: string;
  targetQuantity?: number;
  targetUnitId?: string;
}

async function fetchProductsForConfig(establishmentId: string): Promise<ProductForConfig[]> {
  // Fetch products
  const { data: products, error: prodErr } = await supabase
    .from("products_v2")
    .select("id, nom_produit, final_unit_id, supplier_billing_unit_id, delivery_unit_id, stock_handling_unit_id, conditionnement_config")
    .eq("establishment_id", establishmentId)
    .is("archived_at", null)
    .order("nom_produit");

  if (prodErr) throw prodErr;

  // Fetch existing configs
  const { data: configs, error: confErr } = await supabase
    .from("product_input_config")
    .select("*")
    .eq("establishment_id", establishmentId);

  if (confErr) throw confErr;

  // Fetch ALL measurement units for BFS engine (not just referenced ones)
  const { data: allUnits, error: unitErr } = await supabase
    .from("measurement_units")
    .select("id, name, abbreviation, category, family, is_reference, aliases")
    .eq("establishment_id", establishmentId);

  if (unitErr) throw unitErr;

  // Fetch unit conversions for BFS engine
  const { data: allConversions, error: convErr } = await supabase
    .from("unit_conversions")
    .select("id, from_unit_id, to_unit_id, factor, establishment_id, is_active")
    .or(`establishment_id.eq.${establishmentId},establishment_id.is.null`);

  if (convErr) throw convErr;

  const dbUnits: UnitWithFamily[] = (allUnits ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    abbreviation: u.abbreviation,
    category: u.category,
    family: u.family,
    is_reference: u.is_reference,
    aliases: u.aliases,
  }));

  const dbConversions: ConversionRule[] = (allConversions ?? []).map((c) => ({
    id: c.id,
    from_unit_id: c.from_unit_id,
    to_unit_id: c.to_unit_id,
    factor: c.factor,
    establishment_id: c.establishment_id,
    is_active: c.is_active,
  }));

  // Build unit family/name maps for display enrichment
  const unitFamilyMap: Record<string, string> = {};
  const unitNameMap: Record<string, string> = {};
  for (const u of dbUnits) {
    unitFamilyMap[u.id] = u.family ?? "count";
    unitNameMap[u.id] = u.name ?? u.abbreviation ?? u.id;
  }

  const configMap = new Map(
    (configs as ProductInputConfigRow[]).map((c) => [c.product_id, c]),
  );

  const rawProducts = products as RawProduct[];

  return rawProducts.map((p) => {
    try {
      return computeProductForConfig(p, unitFamilyMap, unitNameMap, configMap, dbUnits, dbConversions);
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error("❌ [InputConfig] Product crash in BFS engine", {
          productId: p.id,
          name: p.nom_produit,
          error: e,
        });
      }
      // Return a safe fallback so one broken product doesn't crash the entire list
      const finalUnit = p.final_unit_id ? (unitNameMap[p.final_unit_id] ?? null) : null;
      return {
        id: p.id,
        nom_produit: p.nom_produit ?? "(sans nom)",
        final_unit: finalUnit,
        final_unit_id: p.final_unit_id,
        unit_family: "discrete" as const,
        product_nature: "simple" as ProductNature,
        packaging_levels_count: 0,
        packaging_levels: [],
        has_equivalence: false,
        equivalence_target_family: null,
        equivalence_label: null,
        equivalence_display: null,
        has_supplier_context: false,
        config: configMap.get(p.id) ?? null,
        stock_handling_unit_id: p.stock_handling_unit_id ?? null,
        supplier_billing_unit_id: p.supplier_billing_unit_id ?? null,
        delivery_unit_id: p.delivery_unit_id ?? null,
        conditionnement_config_raw: p.conditionnement_config ?? null,
        autoConfigPayload: null,
        status: "error" as const,
        reception_status: "error" as const,
        internal_status: "error" as const,
      } as ProductForConfig;
    }
  });
}

/** Core per-product computation — extracted for try/catch isolation */
function computeProductForConfig(
  p: RawProduct,
  unitFamilyMap: Record<string, string>,
  unitNameMap: Record<string, string>,
  configMap: Map<string, ProductInputConfigRow>,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
): ProductForConfig {
    const cc = p.conditionnement_config;
    const packagingLevels = Array.isArray(cc?.packagingLevels) ? cc.packagingLevels as ProductForConfig["packaging_levels"] : [];
    const family = p.final_unit_id ? (unitFamilyMap[p.final_unit_id] ?? "count") : "count";
    const unitFamily = resolveUnitNature(family);
    const config = configMap.get(p.id) ?? null;

    // Resolve final unit label from UUID — no legacy text fallback
    const finalUnit = p.final_unit_id ? (unitNameMap[p.final_unit_id] ?? null) : null;

    // ── Equivalence detection ──
    const eq = cc?.equivalence as EquivalenceConfig | undefined;
    const hasEquivalence = !!(eq?.targetUnitId && eq?.sourceUnitId);
    let equivalenceTargetFamily = null;
    let equivalenceLabel: string | null = null;
    let equivalenceDisplay: string | null = null;
    if (hasEquivalence && eq?.targetUnitId) {
      const targetFam = unitFamilyMap[eq.targetUnitId];
      equivalenceTargetFamily = targetFam ? resolveUnitNature(targetFam) : null;
      equivalenceLabel = unitNameMap[eq.targetUnitId] ?? null;
      const srcLabel = eq.sourceUnitId ? (unitNameMap[eq.sourceUnitId] ?? "") : "";
      const tgtLabel = equivalenceLabel ?? "";
      const srcQty = eq.sourceQuantity ?? 1;
      const tgtQty = eq.targetQuantity ?? 1;
      equivalenceDisplay = `${srcQty} ${srcLabel} ≈ ${tgtQty} ${tgtLabel}`;
    }

    // ── Supplier context detection ──
    const supplierBillingFamily = p.supplier_billing_unit_id
      ? resolveUnitNature(unitFamilyMap[p.supplier_billing_unit_id] ?? "count")
      : null;
    const hasSupplierContext = supplierBillingFamily !== null && supplierBillingFamily !== unitFamily;

    // ── Product nature classification (for UX labels only) ──
    const productNature: ProductNature = classifyProductNature(
      unitFamily,
      hasEquivalence,
      equivalenceTargetFamily,
      supplierBillingFamily,
    );

    // ── Build the enriched product (without status yet) ──
    const productForConfig: Omit<ProductForConfig, "status" | "reception_status" | "internal_status"> = {
      id: p.id,
      nom_produit: p.nom_produit ?? "(sans nom)",
      final_unit: finalUnit,
      final_unit_id: p.final_unit_id,
      unit_family: unitFamily,
      product_nature: productNature,
      packaging_levels_count: packagingLevels.length,
      packaging_levels: packagingLevels,
      has_equivalence: hasEquivalence,
      equivalence_target_family: equivalenceTargetFamily,
      equivalence_label: equivalenceLabel,
      equivalence_display: equivalenceDisplay,
      has_supplier_context: hasSupplierContext,
      config,
      stock_handling_unit_id: p.stock_handling_unit_id ?? null,
      supplier_billing_unit_id: p.supplier_billing_unit_id ?? null,
      delivery_unit_id: p.delivery_unit_id ?? null,
      conditionnement_config_raw: cc ?? null,
      autoConfigPayload: null, // will be computed below after BFS
    };

    // ── ENGINE-DRIVEN STATUS COMPUTATION ──
    const engineContext = resolveProductUnitContext(
      {
        stock_handling_unit_id: p.stock_handling_unit_id,
        final_unit_id: p.final_unit_id,
        delivery_unit_id: p.delivery_unit_id,
        supplier_billing_unit_id: p.supplier_billing_unit_id,
        conditionnement_config: cc as unknown as ConditioningConfig | undefined,
      },
      dbUnits,
      dbConversions,
    );

    const reachableUnits = engineContext.allowedInventoryEntryUnits;
    const receptionChoices = buildUnitChoicesFromEngine(
      productForConfig as ProductForConfig,
      reachableUnits,
      "reception",
    );
    const internalChoices = buildUnitChoicesFromEngine(
      productForConfig as ProductForConfig,
      reachableUnits,
      "internal",
    );

    const reachableUnitIds = new Set(reachableUnits.map((u) => u.id));

    // ── AUTO-CONFIG PAYLOAD (mono-unit products) ──
    let autoConfigPayload: AutoConfigPayload | null = null;
    if (
      receptionChoices.length === 1 &&
      internalChoices.length === 1 &&
      receptionChoices[0].primaryUnitId &&
      internalChoices[0].primaryUnitId
    ) {
      autoConfigPayload = {
        reception_mode: receptionChoices[0].mode,
        reception_preferred_unit_id: receptionChoices[0].primaryUnitId,
        internal_mode: internalChoices[0].mode,
        internal_preferred_unit_id: internalChoices[0].primaryUnitId,
      };
    }

    const { global, reception, internal } = computeConfigStatusFromChoices(
      config,
      receptionChoices,
      internalChoices,
      reachableUnitIds,
    );

    return {
      ...productForConfig,
      autoConfigPayload,
      status: global,
      reception_status: reception,
      internal_status: internal,
    };
}

export function useProductsForConfig() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["product-input-config", establishmentId],
    queryFn: () => fetchProductsForConfig(establishmentId!),
    enabled: !!establishmentId,
    staleTime: 30_000,
  });
}

/** Client-side filtering of products */
export function filterProducts(
  products: ProductForConfig[],
  filters: InputConfigFilters,
): ProductForConfig[] {
  return products.filter((p) => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!p.nom_produit.toLowerCase().includes(q)) return false;
    }
    if (filters.unitFamily !== "all" && p.unit_family !== filters.unitFamily) return false;
    if (filters.levelsCount !== "all") {
      if (filters.levelsCount === "0" && p.packaging_levels_count !== 0) return false;
      if (filters.levelsCount === "1" && p.packaging_levels_count !== 1) return false;
      if (filters.levelsCount === "2+" && p.packaging_levels_count < 2) return false;
    }
    if (filters.status !== "all" && p.status !== filters.status) return false;
    return true;
  });
}
