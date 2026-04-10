/**
 * StockBreakdownCell — Displays snapshot stock breakdown with unit conversion.
 * Extracted from DesktopInventoryView for file-size compliance.
 *
 * REFACTORED: Now delegates display logic to resolveStockDisplay (SSOT).
 */

import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DesktopProductStock } from "../hooks/useDesktopStock";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import { resolveStockDisplay, type StockDisplayProductInput } from "../utils/resolveStockDisplay";
import { formatQtyDisplay } from "./inventoryDisplayUtils";
import { displayUnitName } from "@/lib/units/displayUnitName";
import type { StockUnitMode } from "./EstimatedStockCell";
import type { ProductInputConfigRow } from "@/modules/inputConfig/types";

interface StockBreakdownCellProps {
  product: DesktopProductStock;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
  stockUnitMode: StockUnitMode;
  inputConfig?: ProductInputConfigRow | null;
}

function toDisplayInput(product: DesktopProductStock): StockDisplayProductInput {
  return {
    stock_handling_unit_id: product.stock_handling_unit_id,
    final_unit_id: product.final_unit_id,
    delivery_unit_id: product.delivery_unit_id,
    supplier_billing_unit_id: product.supplier_billing_unit_id,
    conditionnement_config: product.conditionnement_config,
    preferred_display_unit_id: product.preferred_display_unit_id,
    inventory_display_unit_id: product.inventory_display_unit_id,
  };
}

export function StockBreakdownCell({
  product,
  dbUnits,
  dbConversions,
  stockUnitMode,
  inputConfig,
}: StockBreakdownCellProps) {
  const display = useMemo(() => {
    if (product.last_quantity === null || product.last_quantity === undefined) return null;
    return resolveStockDisplay(toDisplayInput(product), product.last_quantity, dbUnits, dbConversions, stockUnitMode, inputConfig);
  }, [
    product.last_quantity,
    product.preferred_display_unit_id,
    product.inventory_display_unit_id,
    product.conditionnement_config,
    product.delivery_unit_id,
    product.final_unit_id,
    product.stock_handling_unit_id,
    product.supplier_billing_unit_id,
    dbUnits,
    dbConversions,
    stockUnitMode,
    inputConfig,
  ]);

  if (product.last_quantity === null || product.last_quantity === undefined) {
    return (
      <span
        className="text-sm text-muted-foreground"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        &mdash;
      </span>
    );
  }

  if (!display) {
    const unit = dbUnits.find((u) => u.id === product.last_unit_id);
    return (
      <div className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
        <span className="text-sm text-muted-foreground">
          {formatQtyDisplay(product.last_quantity)}
        </span>{" "}
        <span className="text-xs text-muted-foreground">{unit?.name ?? "?"}</span>
      </div>
    );
  }

  if (display.mode === "no_supplier" || display.mode === "no_conversion") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="text-sm text-muted-foreground cursor-help"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            &mdash;
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            {display.mode === "no_supplier"
              ? "Unité de livraison non configurée"
              : "Conversion vers unité de livraison non disponible"}
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (display.mode === "supplier") {
    return (
      <div className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
        <span className="text-sm font-medium text-foreground">{formatQtyDisplay(display.qty)}</span>{" "}
        <span className="text-xs text-muted-foreground">{display.unitName}</span>
      </div>
    );
  }

  return (
    <div className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
      <span className="text-sm font-medium text-foreground">{display.result.label}</span>
    </div>
  );
}
