/**
 * useInventoryProductDrawer — Extracted state, memos, and handlers
 * from InventoryProductDrawer.tsx for file size compliance.
 *
 * Pure hook: no JSX, no side-effects beyond React Query invalidation.
 */

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProductV2, useProductV2Mutations } from "@/modules/produitsV2";
import { useUnits } from "@/hooks/useUnits";
import { useUnitConversions } from "@/core/unitConversion";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";
import { resolveDisplayPrice, type PriceDisplayProduct } from "@/modules/produitsV2";
import { buildStructureSummary } from "@/core/unitConversion/buildStructureSummary";
import { computeDisplayBreakdown } from "../utils/computeDisplayBreakdown";
import type { DesktopProductStock } from "../hooks/useDesktopStock";
import { updateProductV2 } from "@/modules/produitsV2";
import { useQueryClient } from "@tanstack/react-query";

interface UseInventoryProductDrawerParams {
  open: boolean;
  stockItem: DesktopProductStock | null;
  onStockUpdate: (
    product: DesktopProductStock,
    quantity: number,
    unitId: string | null,
    unitLabel?: string
  ) => void;
}

export function useInventoryProductDrawer({
  open,
  stockItem,
  onStockUpdate,
}: UseInventoryProductDrawerParams) {
  const productId = stockItem?.product_id ?? null;
  const { product, isLoading } = useProductV2(open ? productId : null);
  const { update: _update } = useProductV2Mutations();
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { units: allUnits, kitchenUnits } = useUnits();
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();

  // Stock local state
  const [stockQty, setStockQty] = useState("");
  const [stockUnitId, setStockUnitId] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Inventory display unit -- pending state (not auto-saved)
  const [pendingDisplayUnitId, setPendingDisplayUnitId] = useState<string | null>(null);
  const savedPreferredUnitId = stockItem?.preferred_display_unit_id ?? null;
  const displayUnitDirty = pendingDisplayUnitId !== savedPreferredUnitId;

  // Kitchen unit local state (explicit save)
  const [localKitchenUnitId, setLocalKitchenUnitId] = useState<string | null>(null);
  const [kitchenDirty, setKitchenDirty] = useState(false);

  // Stock handling unit local state (explicit save)
  const [localStockUnitId, setLocalStockUnitId] = useState<string | null>(null);
  const [stockUnitDirty, setStockUnitDirty] = useState(false);

  // Price display unit local state
  const [localPriceDisplayUnitId, setLocalPriceDisplayUnitId] = useState<string | null>(null);
  const [priceDisplayDirty, setPriceDisplayDirty] = useState(false);

  // Init from product
  useEffect(() => {
    if (product && open) {
      setLocalKitchenUnitId(product.kitchen_unit_id ?? null);
      setKitchenDirty(false);
      setLocalStockUnitId(product.stock_handling_unit_id ?? null);
      setStockUnitDirty(false);
      setLocalPriceDisplayUnitId(product.price_display_unit_id ?? null);
      setPriceDisplayDirty(false);
    }
  }, [product, open]);

  // Init stock fields + display unit from stockItem
  useEffect(() => {
    if (stockItem && open) {
      setStockQty(stockItem.last_quantity?.toString() ?? "");
      setStockUnitId(stockItem.last_unit_id ?? null);
      setPendingDisplayUnitId(stockItem.preferred_display_unit_id ?? null);
    }
  }, [stockItem, open]);

  // Unit resolution helper
  const getUnitLabel = (id: string | null): string | null => {
    if (!id) return null;
    const u = allUnits.find((unit) => unit.id === id);
    return u ? `${u.name} (${u.abbreviation})` : null;
  };

  // Product shape for SSOT context service
  const productForGraph: ProductUnitInput | null = useMemo(() => {
    if (!product) return null;
    return {
      stock_handling_unit_id: product.stock_handling_unit_id ?? null,
      final_unit_id: product.final_unit_id ?? null,
      delivery_unit_id: product.delivery_unit_id ?? null,
      supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
      conditionnement_config: product.conditionnement_config ?? null,
    };
  }, [product]);

  // Structure summary
  const structureSummary = useMemo(() => {
    if (!product?.conditionnement_config) return null;
    const config = product.conditionnement_config;
    return buildStructureSummary(
      config.packagingLevels ?? [],
      config.equivalence ?? null,
      config.finalUnit ?? null,
      config.final_unit_id ?? null,
      dbUnits,
      dbConversions
    );
  }, [product, dbUnits, dbConversions]);

  // Unit context via centralized SSOT service
  const unitContext = useMemo(() => {
    if (!productForGraph) return null;
    return resolveProductUnitContext(productForGraph, dbUnits, dbConversions);
  }, [productForGraph, dbUnits, dbConversions]);

  // Backward-compatible inventoryOpts shape
  const inventoryOpts = useMemo(() => {
    if (!unitContext) return null;
    return {
      targetUnitId: unitContext.canonicalInventoryUnitId,
      targetUnitLabel: unitContext.canonicalLabel,
      options: unitContext.allowedInventoryEntryUnits.map((u) => ({
        unitId: u.id,
        name: u.name,
        abbreviation: u.abbreviation,
        kind: u.kind,
        factorToTarget: u.factorToTarget,
      })),
      needsConfiguration: unitContext.needsConfiguration,
    };
  }, [unitContext]);

  // Price display
  const priceDisplay = useMemo(() => {
    if (!product) return null;
    const priceProduct: PriceDisplayProduct = {
      final_unit_price: product.final_unit_price ?? null,
      final_unit_id: product.final_unit_id ?? null,
      supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
      price_display_unit_id: localPriceDisplayUnitId,
      conditionnement_config: product.conditionnement_config ?? null,
    };
    return resolveDisplayPrice(priceProduct, dbUnits, dbConversions);
  }, [product, localPriceDisplayUnitId, dbUnits, dbConversions]);

  // Save handlers
  const handleSaveStock = () => {
    if (!stockItem) return;
    const qty = parseFloat(stockQty);
    if (isNaN(qty) || qty < 0) return;
    const selectedUnit = dbUnits.find((u) => u.id === stockUnitId);
    const unitLabel = selectedUnit?.name || selectedUnit?.abbreviation;
    onStockUpdate(stockItem, qty, stockUnitId, unitLabel);
    toast.success("Stock mis a jour");
  };

  // P0-4 FIX: All unit saves invalidate desktop-stock + inventory-lines
  const invalidateAllProductCaches = (pid: string) => {
    queryClient.invalidateQueries({ queryKey: ["product-v2", pid] });
    queryClient.invalidateQueries({ queryKey: ["products-v2"] });
    queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
  };

  const handleSaveKitchenUnit = async () => {
    if (!productId) return;
    await updateProductV2(productId, { kitchen_unit_id: localKitchenUnitId });
    invalidateAllProductCaches(productId);
    setKitchenDirty(false);
    toast.success("Unite cuisine enregistree");
  };

  const handleSaveStockUnit = async () => {
    if (!productId) return;
    await updateProductV2(productId, { stock_handling_unit_id: localStockUnitId });
    invalidateAllProductCaches(productId);
    setStockUnitDirty(false);
    toast.success("Unite inventaire enregistree");
  };

  const handleSavePriceDisplayUnit = async () => {
    if (!productId) return;
    await updateProductV2(productId, { price_display_unit_id: localPriceDisplayUnitId });
    invalidateAllProductCaches(productId);
    setPriceDisplayDirty(false);
    toast.success("Unite d'affichage prix enregistree");
  };

  const handleSaveInventoryDisplayUnit = async () => {
    if (!productId || !stockItem?.storage_zone_id || !estId) return;

    // BFS guard: only allow BFS-reachable units
    if (pendingDisplayUnitId && inventoryOpts) {
      const isReachable = inventoryOpts.options.some((o) => o.unitId === pendingDisplayUnitId);
      if (!isReachable) {
        toast.error("Unite non convertible pour ce produit");
        return;
      }
    }

    // Upsert inventory_zone_products.preferred_unit_id
    const { error } = await supabase.from("inventory_zone_products").upsert(
      {
        product_id: productId,
        storage_zone_id: stockItem.storage_zone_id,
        establishment_id: estId,
        preferred_unit_id: pendingDisplayUnitId,
      },
      { onConflict: "product_id,storage_zone_id" }
    );

    if (error) {
      toast.error("Erreur lors de la sauvegarde");
      if (import.meta.env.DEV) console.error(error);
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
    queryClient.invalidateQueries({ queryKey: ["product-v2", productId] });
    toast.success("Affichage mis a jour");
  };

  const handleCancelDisplayUnit = () => {
    setPendingDisplayUnitId(savedPreferredUnitId);
  };

  // Breakdown display (memoized)
  const breakdownDisplay = useMemo(() => {
    if (!inventoryOpts || inventoryOpts.needsConfiguration) return null;
    const canonicalQty = parseFloat(stockQty) || 0;
    if (canonicalQty === 0) return null;
    const displayUnitId = pendingDisplayUnitId ?? inventoryOpts.targetUnitId;
    if (!displayUnitId) return null;
    return computeDisplayBreakdown(
      canonicalQty,
      displayUnitId,
      inventoryOpts.options.map((o) => ({
        id: o.unitId,
        name: o.name,
        abbreviation: o.abbreviation,
        kind: o.kind,
        factorToTarget: o.factorToTarget,
      }))
    );
  }, [stockQty, pendingDisplayUnitId, inventoryOpts]);

  // 5 unit rows data
  const unitRows = useMemo(() => {
    if (!product) return [];
    return [
      {
        label: "Livraison",
        unitId: product.delivery_unit_id ?? null,
        source: "Wizard",
        editable: false,
      },
      {
        label: "Facture",
        unitId: product.supplier_billing_unit_id ?? null,
        source: "Wizard",
        editable: false,
      },
      {
        label: "Stock / Inventaire",
        unitId: localStockUnitId,
        source: "Parametre",
        editable: true,
        kind: "stock" as const,
      },
      {
        label: "Reference interne",
        unitId: product.final_unit_id ?? null,
        source: "Wizard",
        editable: false,
      },
      {
        label: "Cuisine / Recette",
        unitId: localKitchenUnitId,
        source: "Parametre",
        editable: true,
        kind: "kitchen" as const,
      },
    ];
  }, [product, localStockUnitId, localKitchenUnitId]);

  return {
    // Data
    product,
    productId,
    isLoading,
    allUnits,
    kitchenUnits,
    dbUnits,
    dbConversions,

    // Stock state
    stockQty,
    setStockQty,
    stockUnitId,
    setStockUnitId,
    popoverOpen,
    setPopoverOpen,

    // Display unit state
    pendingDisplayUnitId,
    setPendingDisplayUnitId,
    displayUnitDirty,

    // Kitchen unit state
    localKitchenUnitId,
    setLocalKitchenUnitId,
    kitchenDirty,
    setKitchenDirty,

    // Stock unit state
    localStockUnitId,
    setLocalStockUnitId,
    stockUnitDirty,
    setStockUnitDirty,

    // Price display unit state
    localPriceDisplayUnitId,
    setLocalPriceDisplayUnitId,
    priceDisplayDirty,
    setPriceDisplayDirty,

    // Memos
    productForGraph,
    structureSummary,
    unitContext,
    inventoryOpts,
    priceDisplay,
    breakdownDisplay,
    unitRows,
    getUnitLabel,

    // Handlers
    handleSaveStock,
    handleSaveKitchenUnit,
    handleSaveStockUnit,
    handleSavePriceDisplayUnit,
    handleSaveInventoryDisplayUnit,
    handleCancelDisplayUnit,
  };
}
