/**
 * StockStatusBadge — Displays Rupture / Sous seuil / OK / Conflit historique badge.
 */

import { AlertTriangle, CheckCircle2, X, AlertCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import type { DesktopProductStock } from "../hooks/useDesktopStock";
import type { EstimatedStockOutcome } from "@/modules/stockLedger";
import { getErrorDiagnosticLabel } from "@/modules/stockLedger";
import type { StockEngineError } from "@/modules/stockLedger";

interface StockStatusBadgeProps {
  product: DesktopProductStock;
  estimatedStock: Map<string, EstimatedStockOutcome>;
}

export function StockStatusBadge({ product, estimatedStock }: StockStatusBadgeProps) {
  const outcome = estimatedStock.get(product.product_id);

  if (!outcome) {
    return <span className="text-muted-foreground/40 text-xs">&mdash;</span>;
  }

  // Error state: distinguish NO_SNAPSHOT_LINE ("Non initialisé") from others
  if (!outcome.ok) {
    const errCode = (outcome as { ok: false; error: StockEngineError }).error.code;
    const diagnostic = getErrorDiagnosticLabel(errCode);
    const label = errCode === "NO_SNAPSHOT_LINE" ? "Non initialisé" : "Non calculable";
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="border-muted-foreground/40 text-muted-foreground text-[10px] gap-1 cursor-help"
            >
              <AlertCircle className="h-3 w-3" />
              {label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[250px]">
            <p className="text-xs font-medium">{errCode}</p>
            <p className="text-xs text-muted-foreground">{diagnostic}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const est = outcome.data.estimated_quantity;
  const minStock = product.min_stock_quantity_canonical;
  const warningsBadge = null;

  if (est <= 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-destructive">
              <X className="h-3.5 w-3.5 text-destructive-foreground" />
            </span>
          </TooltipTrigger>
          <TooltipContent><p className="text-xs">Rupture</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (minStock != null && est < minStock) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex"><AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-400" /></span>
          </TooltipTrigger>
          <TooltipContent><p className="text-xs">Sous seuil</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex"><CheckCircle2 className="h-5 w-5 text-emerald-500 dark:text-emerald-400" /></span>
        </TooltipTrigger>
        <TooltipContent><p className="text-xs">OK</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
