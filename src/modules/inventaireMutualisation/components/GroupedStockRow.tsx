/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — GroupedStockRow (Expandable group header)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure presentation component that renders:
 * 1. A collapsible parent row showing the group name + aggregated stock
 * 2. Child rows (standard product rows) when expanded
 *
 * No writes, no side-effects on products.
 */

import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight, Layers, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { TableRow, TableCell } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DesktopProductStock } from "@/modules/inventaire/hooks/useDesktopStock";
import type { EstimatedStockOutcome } from "@/modules/stockLedger";
import type { UnitWithFamily } from "@/core/unitConversion/types";

interface GroupedStockRowProps {
  groupId: string;
  displayName: string;
  carrierProductId: string;
  children: DesktopProductStock[];
  estimatedStock: Map<string, EstimatedStockOutcome>;
  /** Render function for individual child rows */
  renderChildRow: (product: DesktopProductStock) => React.ReactNode;
  /** Number of visible columns for colSpan */
  colSpan: number;
  /** Available units for label resolution */
  dbUnits?: UnitWithFamily[];
}

export function GroupedStockRow({
  displayName,
  carrierProductId,
  children,
  estimatedStock,
  renderChildRow,
  colSpan,
  dbUnits,
}: GroupedStockRowProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  // Compute aggregated quantity from estimatedStock
  // Clamp each child to 0 (same as EstimatedStockCell) to avoid negative drift
  const aggregated = children.reduce((sum, child) => {
    const outcome = estimatedStock.get(child.product_id);
    if (outcome?.ok) {
      return sum + Math.max(0, outcome.data.estimated_quantity);
    }
    return sum;
  }, 0);

  // Carrier threshold (from the carrier product directly — no duplication)
  const carrier = children.find((c) => c.product_id === carrierProductId);
  const minStock = carrier?.min_stock_quantity_canonical ?? null;

  // Resolve unit label from carrier product's stock handling unit
  const unitId = carrier?.stock_handling_unit_id ?? carrier?.final_unit_id;
  const unitLabel = unitId && dbUnits ? (dbUnits.find((u) => u.id === unitId)?.name ?? "") : "";

  // Alert level
  const alertLevel =
    aggregated <= 0
      ? "rupture"
      : minStock !== null && aggregated < minStock
        ? "warning"
        : "ok";

  return (
    <>
      {/* Group header row */}
      <TableRow
        className="cursor-pointer hover:bg-muted/40 transition-colors bg-muted/20"
        onClick={toggle}
      >
        <TableCell colSpan={colSpan - 1} className="py-3">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Layers className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground">{displayName}</span>
            <span className="text-xs text-muted-foreground">
              ({children.length} produit{children.length > 1 ? "s" : ""})
            </span>
            <span className="text-sm font-mono text-foreground ml-auto mr-4">
              {aggregated.toFixed(2)}{unitLabel ? ` ${unitLabel}` : ""}
            </span>
          </div>
        </TableCell>
        <TableCell className="text-center py-3">
          {alertLevel === "rupture" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-destructive">
                  <X className="h-3.5 w-3.5 text-destructive-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">Rupture</p></TooltipContent>
            </Tooltip>
          )}
          {alertLevel === "warning" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex"><AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-400" /></span>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">Sous seuil</p></TooltipContent>
            </Tooltip>
          )}
          {alertLevel === "ok" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex"><CheckCircle2 className="h-5 w-5 text-emerald-500 dark:text-emerald-400" /></span>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">OK</p></TooltipContent>
            </Tooltip>
          )}
        </TableCell>
      </TableRow>

      {/* Child rows (only when expanded) */}
      {expanded && children.map((child) => renderChildRow(child))}
    </>
  );
}
