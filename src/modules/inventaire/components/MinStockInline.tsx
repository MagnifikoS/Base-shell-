/**
 * MinStockInline — Inline (no TableCell wrapper) threshold display for embedding in stock cells.
 */

import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DesktopProductStock } from "../hooks/useDesktopStock";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";
import { formatQtyDisplay } from "./inventoryDisplayUtils";
import { displayUnitName } from "@/lib/units/displayUnitName";
import type { StockUnitMode } from "./EstimatedStockCell";

interface MinStockInlineProps {
  product: DesktopProductStock;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
  stockUnitMode: StockUnitMode;
}

export function MinStockInline({
  product,
  dbUnits,
  dbConversions,
  stockUnitMode,
}: MinStockInlineProps) {
  const { displayLabel, displayMode } = useMemo(() => {
    const canonical = product.min_stock_quantity_canonical;
    const minUnitId = product.min_stock_unit_id;

    const productForGraph: ProductUnitInput = {
      stock_handling_unit_id: product.stock_handling_unit_id,
      final_unit_id: product.final_unit_id,
      delivery_unit_id: product.delivery_unit_id,
      supplier_billing_unit_id: product.supplier_billing_unit_id,
      conditionnement_config: product.conditionnement_config,
    };

    const ctx = resolveProductUnitContext(productForGraph, dbUnits, dbConversions);

    if (canonical == null || ctx.needsConfiguration || !ctx.canonicalInventoryUnitId) {
      return { displayLabel: null, displayMode: "ok" as const };
    }

    if (stockUnitMode === "supplier") {
      const deliveryUnitId = product.delivery_unit_id;
      if (!deliveryUnitId) return { displayLabel: null, displayMode: "no_supplier" as const };
      const deliveryEntry =
        ctx.allowedInventoryEntryUnits.find((u) => u.id === deliveryUnitId) ??
        ctx.allowedPriceDisplayUnits.find((u) => u.id === deliveryUnitId);
      if (!deliveryEntry || deliveryEntry.factorToTarget === 0)
        return { displayLabel: null, displayMode: "no_conversion" as const };
      const converted = Math.round((canonical / deliveryEntry.factorToTarget) * 10000) / 10000;
      const unitObj = dbUnits.find((u) => u.id === deliveryUnitId);
      return {
        displayLabel: { qty: converted, unitName: unitObj ? displayUnitName(unitObj) : "?" },
        displayMode: "ok" as const,
      };
    }

    const savedUnit = minUnitId
      ? ctx.allowedInventoryEntryUnits.find((u) => u.id === minUnitId)
      : null;
    const displayUnit = savedUnit ?? ctx.allowedInventoryEntryUnits[0];
    if (!displayUnit) return { displayLabel: null, displayMode: "ok" as const };

    const displayQty = Math.round((canonical / displayUnit.factorToTarget) * 10000) / 10000;
    const unitObj = dbUnits.find((u) => u.id === displayUnit.id);
    return {
      displayLabel: { qty: displayQty, unitName: unitObj ? displayUnitName(unitObj) : "?" },
      displayMode: "ok" as const,
    };
  }, [product, dbUnits, dbConversions, stockUnitMode]);

  if (displayMode === "no_supplier" || displayMode === "no_conversion") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-[10px] text-muted-foreground/60 cursor-help">
            Seuil : —
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            {displayMode === "no_supplier"
              ? "Unité de livraison non configurée"
              : "Conversion seuil vers unité de livraison non disponible"}
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (!displayLabel) return null;

  return (
    <span className="text-[10px] text-muted-foreground/60" style={{ fontVariantNumeric: "tabular-nums" }}>
      Seuil : {formatQtyDisplay(displayLabel.qty)} {displayLabel.unitName}
    </span>
  );
}
