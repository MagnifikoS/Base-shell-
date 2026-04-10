/**
 * MinStockTableCell — READ-ONLY display of min stock threshold.
 * Extracted from DesktopInventoryView for file-size compliance.
 */

import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TableCell } from "@/components/ui/table";
import type { DesktopProductStock } from "../hooks/useDesktopStock";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";
import { formatQtyDisplay } from "./inventoryDisplayUtils";
import { displayUnitName } from "@/lib/units/displayUnitName";
import type { StockUnitMode } from "./EstimatedStockCell";

interface MinStockTableCellProps {
  product: DesktopProductStock;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
  stockUnitMode: StockUnitMode;
}

export function MinStockTableCell({
  product,
  dbUnits,
  dbConversions,
  stockUnitMode,
}: MinStockTableCellProps) {
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
      const billingUnitId = product.supplier_billing_unit_id;
      if (!billingUnitId) return { displayLabel: null, displayMode: "no_supplier" as const };
      const billingEntry =
        ctx.allowedInventoryEntryUnits.find((u) => u.id === billingUnitId) ??
        ctx.allowedPriceDisplayUnits.find((u) => u.id === billingUnitId);
      if (!billingEntry || billingEntry.factorToTarget === 0)
        return { displayLabel: null, displayMode: "no_conversion" as const };
      const converted = Math.round((canonical / billingEntry.factorToTarget) * 10000) / 10000;
      const unitObj = dbUnits.find((u) => u.id === billingUnitId);
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
      <TableCell className="text-right py-3">
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
              {displayMode === "no_supplier"
                ? "Unit\u00e9 fournisseur non configur\u00e9e"
                : "Conversion seuil vers unit\u00e9 fournisseur non disponible"}
            </p>
          </TooltipContent>
        </Tooltip>
      </TableCell>
    );
  }

  return (
    <TableCell className="text-right py-3" style={{ fontVariantNumeric: "tabular-nums" }}>
      {displayLabel ? (
        <span className="text-sm">
          <span className="text-foreground">{formatQtyDisplay(displayLabel.qty)}</span>{" "}
          <span className="text-xs text-muted-foreground">{displayLabel.unitName}</span>
        </span>
      ) : (
        <span className="text-muted-foreground/40 text-sm">&mdash;</span>
      )}
    </TableCell>
  );
}
