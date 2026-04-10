/**
 * EstimatedStockCell — Displays estimated (realtime) stock with unit conversion.
 * Extracted from DesktopInventoryView for file-size compliance.
 *
 * REFACTORED: Now delegates display logic to resolveStockDisplay (SSOT).
 */

import { useMemo } from "react";
import { Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DesktopProductStock } from "../hooks/useDesktopStock";
import type { EstimatedStockOutcome, StockEngineError } from "@/modules/stockLedger";
import { getErrorDiagnosticLabel } from "@/modules/stockLedger";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import { resolveStockDisplay, type StockDisplayProductInput } from "../utils/resolveStockDisplay";
import { formatQtyDisplay } from "./inventoryDisplayUtils";
import { displayUnitName } from "@/lib/units/displayUnitName";
import type { ProductInputConfigRow } from "@/modules/inputConfig/types";

export type StockUnitMode = "canonical" | "supplier";

interface EstimatedStockCellProps {
  product: DesktopProductStock;
  estimatedStock: Map<string, EstimatedStockOutcome>;
  /** Quantity currently in transit (awaiting validation). 0 = none. */
  inTransitQty: number;
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

export function EstimatedStockCell({
  product,
  estimatedStock,
  inTransitQty,
  dbUnits,
  dbConversions,
  stockUnitMode,
  inputConfig,
}: EstimatedStockCellProps) {
  const outcome = estimatedStock.get(product.product_id);
  const estData = outcome?.ok ? outcome.data : null;
  // Clamp: never show negative stock in UI (écarts module handles tracking)
  const rawQty = estData?.estimated_quantity ?? null;
  const estQty = rawQty !== null ? Math.max(0, rawQty) : null;

  const display = useMemo(() => {
    if (estQty === null || !estData) return null;
    return resolveStockDisplay(toDisplayInput(product), estQty, dbUnits, dbConversions, stockUnitMode, inputConfig);
  }, [
    product.conditionnement_config,
    product.delivery_unit_id,
    product.final_unit_id,
    product.inventory_display_unit_id,
    product.preferred_display_unit_id,
    product.stock_handling_unit_id,
    product.supplier_billing_unit_id,
    estData,
    estQty,
    dbUnits,
    dbConversions,
    stockUnitMode,
    inputConfig,
  ]);

  const hasInTransit = inTransitQty > 0;
  
  const TransitIcon = hasInTransit ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center ml-1 shrink-0 gap-0.5">
          <Clock className="h-3.5 w-3.5 text-destructive" />
          <span className="text-[10px] font-medium text-destructive">
            ({formatQtyDisplay(inTransitQty)})
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">
          {formatQtyDisplay(inTransitQty)} réservé(s) en transit — en attente de validation client
        </p>
      </TooltipContent>
    </Tooltip>
  ) : null;

  if (!outcome) {
    return (
      <span
        className="text-sm text-muted-foreground"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        &mdash;
      </span>
    );
  }

  if (!outcome.ok) {
    const err = (outcome as { ok: false; error: StockEngineError }).error;
    const diagnostic = getErrorDiagnosticLabel(err.code);
    const label =
      err.code === "NO_ACTIVE_SNAPSHOT"
        ? "Pas de référence"
        : err.code === "NO_SNAPSHOT_LINE"
          ? "Non initialisé"
          : "Non calculable";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs text-muted-foreground italic cursor-help">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[250px]">
          <p className="text-xs font-medium">{err.code}</p>
          <p className="text-xs text-muted-foreground">{diagnostic}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (!display) {
    const unit = dbUnits.find((u) => u.id === outcome.data.canonical_unit_id);
    return (
      <div className="text-right inline-flex items-center justify-end gap-0.5" style={{ fontVariantNumeric: "tabular-nums" }}>
        <span className="text-sm text-foreground">
          {formatQtyDisplay(Math.max(0, outcome.data.estimated_quantity))}
        </span>{" "}
        <span className="text-xs text-muted-foreground">{unit ? displayUnitName(unit) : "?"}</span>
        {TransitIcon}
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
      <div className="text-right inline-flex items-center justify-end gap-0.5" style={{ fontVariantNumeric: "tabular-nums" }}>
        <span className="text-sm font-medium text-foreground">{formatQtyDisplay(display.qty)}</span>{" "}
        <span className="text-xs text-muted-foreground">{display.unitName}</span>
        {TransitIcon}
      </div>
    );
  }

  // canonical mode
  return (
    <div className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
      <div className="inline-flex items-center justify-end gap-0.5">
        <span className="text-sm font-medium text-foreground">{display.result.label}</span>
        {TransitIcon}
      </div>
    </div>
  );
}
