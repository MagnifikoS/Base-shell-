/**
 * ProductStockTable — Table of products with stock columns.
 *
 * Safeguards:
 * - Products render as flat rows (product-centric SSOT)
 * - Zero regression on existing stock display
 * - Parent row shows effective threshold from carrier product (Step 5)
 * - Mutualisation grouping is a pure presentation layer (optional)
 */

import { useState, useCallback, Fragment } from "react";
import { displayProductName } from "@/utils/displayName";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Ruler } from "lucide-react";
import type { DesktopProductStock } from "../hooks/useDesktopStock";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { EstimatedStockOutcome } from "@/modules/stockLedger";
import { EstimatedStockCell } from "./EstimatedStockCell";
import { StockBreakdownCell } from "./StockBreakdownCell";
import { MinStockInlineEdit } from "./MinStockInlineEdit";
import { StockStatusBadge } from "./StockStatusBadge";
import { GroupedStockRow } from "@/modules/inventaireMutualisation";
import type { MutualisationDisplayItem } from "@/modules/inventaireMutualisation";
import type { ProductInputConfigRow } from "@/modules/inputConfig/types";

type StockDisplayMode = "realtime" | "snapshot" | "both";

interface ProductStockTableProps {
  products: DesktopProductStock[];
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
  onRowClick: (product: DesktopProductStock) => void;
  showActiveColumn: boolean;
  displayMode: StockDisplayMode;
  estimatedStock: Map<string, EstimatedStockOutcome>;
  inTransitStock: Map<string, number>;
  /** Optional mutualisation display items (when mutualisation is ON) */
  mutualisationItems?: MutualisationDisplayItem<DesktopProductStock>[] | null;
  /** Product input configs for contextual unit display */
  inputConfigMap?: Map<string, ProductInputConfigRow>;
}

export function ProductStockTable({
  products,
  dbUnits,
  dbConversions,
  onRowClick,
  showActiveColumn,
  displayMode,
  estimatedStock,
  inTransitStock,
  mutualisationItems,
  inputConfigMap,
}: ProductStockTableProps) {
  const showRealtime = displayMode === "realtime" || displayMode === "both";
  const showSnapshot = displayMode === "snapshot" || displayMode === "both";

  if (products.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">Aucun produit trouvé</div>;
  }

  const renderProductRow = (
    product: DesktopProductStock,
    _isChild: boolean,
    key: string,
  ) => {
    const activeUnit =
      showActiveColumn && product.active_unit_id
        ? dbUnits.find((u) => u.id === product.active_unit_id)
        : null;

    return (
      <TableRow
        key={key}
        className="group cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => onRowClick(product)}
      >
        <TableCell className="font-medium py-3">
          <span className="uppercase">{displayProductName(product.nom_produit)}</span>
        </TableCell>

        {showRealtime && (
          <TableCell className="text-right py-3">
            <div className="flex flex-col items-end">
              <EstimatedStockCell
                product={product}
                estimatedStock={estimatedStock}
                inTransitQty={inTransitStock.get(product.product_id) ?? 0}
                dbUnits={dbUnits}
                dbConversions={dbConversions}
                stockUnitMode="canonical"
                inputConfig={inputConfigMap?.get(product.product_id)}
              />
              <MinStockInlineEdit
                product={product}
                dbUnits={dbUnits}
                dbConversions={dbConversions}
              />
            </div>
          </TableCell>
        )}

        {showSnapshot && (
          <TableCell className="text-right py-3">
            <div className="flex flex-col items-end">
              <StockBreakdownCell
                product={product}
                dbUnits={dbUnits}
                dbConversions={dbConversions}
                stockUnitMode="canonical"
                inputConfig={inputConfigMap?.get(product.product_id)}
              />
              <MinStockInlineEdit
                product={product}
                dbUnits={dbUnits}
                dbConversions={dbConversions}
              />
            </div>
          </TableCell>
        )}


        <TableCell className="text-center py-3" onClick={(e) => e.stopPropagation()}>
          <StockStatusBadge product={product} estimatedStock={estimatedStock} />
        </TableCell>
      </TableRow>
    );
  };

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b border-border/50">
          <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            Produit
          </TableHead>

          {showRealtime && (
            <TableHead className="w-[160px] text-right text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1">
                    <Ruler className="h-3 w-3 text-muted-foreground/40" />
                    {displayMode === "both" ? "Estimé (Inv.)" : "Stock (Inv.)"}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Stock + seuil en unité de comptage/inventaire</p>
                </TooltipContent>
              </Tooltip>
            </TableHead>
          )}

          {showSnapshot && (
            <TableHead className="w-[160px] text-right text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1">
                    <Ruler className="h-3 w-3 text-muted-foreground/40" />
                    Snapshot (Inv.)
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Dernier comptage en unité de comptage/inventaire</p>
                </TooltipContent>
              </Tooltip>
            </TableHead>
          )}

          <TableHead className="w-[60px] text-center text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mutualisationItems && mutualisationItems.length > 0
          ? mutualisationItems.map((item, idx) => {
              if (item.type === "product" && item.product) {
                return renderProductRow(item.product, false, item.product.product_id);
              }
              if (item.type === "group" && item.group) {
                const colSpan =
                  1 +
                  (showRealtime ? 1 : 0) +
                  (showSnapshot ? 1 : 0) +
                  1; // statut
                return (
                  <GroupedStockRow
                    key={`group-${item.group.id}`}
                    groupId={item.group.id}
                    displayName={item.group.displayName}
                    carrierProductId={item.group.carrierProductId}
                    children={item.group.children}
                    estimatedStock={estimatedStock}
                    colSpan={colSpan}
                    dbUnits={dbUnits}
                    renderChildRow={(child) =>
                      renderProductRow(child, true, `child-${child.product_id}`)
                    }
                  />
                );
              }
              return null;
            })
          : products.map((product) =>
              renderProductRow(product, false, product.product_id)
            )}
      </TableBody>
    </Table>
  );
}
