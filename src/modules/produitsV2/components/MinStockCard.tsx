/**
 * MinStockCard — PHASE 3: Read-only display card.
 * Editing is exclusively done via Wizard V3.
 */
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Lock, AlertTriangle } from "lucide-react";
import { resolveProductUnitContext, type ProductUnitContext } from "@/core/unitConversion";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { ProductV2 } from "../types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MinStockCardProps {
  product: ProductV2;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
}

export function MinStockCard({ product, dbUnits, dbConversions }: MinStockCardProps) {
  const context: ProductUnitContext = useMemo(
    () => resolveProductUnitContext(product, dbUnits, dbConversions),
    [product, dbUnits, dbConversions]
  );

  const canonical = product.min_stock_quantity_canonical;
  const minStockUnitId = product.min_stock_unit_id;
  const updatedAt = product.min_stock_updated_at;
  const hasMinStock = canonical != null;

  const displayInfo = useMemo(() => {
    if (canonical == null || !context.canonicalInventoryUnitId) return null;

    const savedUnit = minStockUnitId
      ? context.allowedInventoryEntryUnits.find((u) => u.id === minStockUnitId)
      : null;
    const displayUnit = savedUnit ?? context.allowedInventoryEntryUnits[0];

    if (!displayUnit) return null;

    const displayQty = canonical / displayUnit.factorToTarget;
    const rounded = Math.round(displayQty * 10000) / 10000;
    return {
      qty: rounded,
      unitLabel: displayUnit.abbreviation,
    };
  }, [canonical, minStockUnitId, context]);

  if (context.needsConfiguration) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Stock minimum
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
            Configuration conditionnement requise avant de définir un stock minimum.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="h-4 w-4" />
          Stock minimum
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Lock className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Modifiable uniquement via le Wizard</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasMinStock && displayInfo ? (
          <div>
            <p className="text-sm font-medium">
              Seuil minimum :{" "}
              <span className="text-foreground font-semibold">
                {displayInfo.qty} {displayInfo.unitLabel}
              </span>
            </p>
            {updatedAt && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Dernière mise à jour : {new Date(updatedAt).toLocaleDateString("fr-FR")}
              </p>
            )}
          </div>
        ) : hasMinStock && !displayInfo ? (
          <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Config incompatible
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Non défini</p>
        )}
      </CardContent>
    </Card>
  );
}
