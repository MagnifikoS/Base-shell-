/**
 * StatusActions — Renders the status cell with action buttons for each product line.
 * Extracted from ExtractedProductsModal for file-size compliance.
 *
 * SMART_MATCH: When enabled, adds ⚡ SmartMatch button alongside existing actions.
 */

import { Button } from "@/components/ui/button";
import { Loader2, Package, Check, Search, Pencil, CheckCircle2, Zap } from "lucide-react";
import { ProductStatusBadge } from "../ProductStatusBadge";
import type { EditableProductLine } from "./extractedTypes";
import type { LineStatusResult } from "@/modules/analyseFacture";
import { SMART_MATCH_ENABLED } from "@/config/featureFlags";

interface StatusActionsProps {
  item: EditableProductLine;
  index: number;
  status: LineStatusResult | undefined;
  isLoadingStatuses: boolean;
  isResolved: boolean;
  confirmedMatches: Record<string, { productId: string; confirmedAt: number }>;
  editableItems: EditableProductLine[];
  onAcceptAsIs: (itemId: string, index: number) => void;
  onOpenSuggestions: (item: EditableProductLine, skipCategory: boolean) => void;
  /** SmartMatch: callback to open the SmartMatch drawer for this line */
  onOpenSmartMatch?: (item: EditableProductLine) => void;
}

/** Helper: check if a matched product has a complete sheet */
function isProductSheetComplete(product: Record<string, unknown> | null | undefined): boolean {
  if (!product) return false;
  return !!(
    product.conditionnement_config &&
    product.final_unit_price != null &&
    product.storage_zone_id &&
    product.min_stock_quantity_canonical != null
  );
}

export function StatusActions({
  item,
  index: _index,
  status,
  isLoadingStatuses,
  isResolved,
  confirmedMatches: _confirmedMatches,
  editableItems,
  onAcceptAsIs,
  onOpenSuggestions,
  onOpenSmartMatch,
}: StatusActionsProps) {
  if (item._validated) {
    const sheetComplete = isProductSheetComplete(
      status?.matchedProduct as unknown as Record<string, unknown>
    );
    return (
      <div className="flex items-center gap-1.5">
        <ProductStatusBadge status="validated" label="Valid\u00e9" />
        {sheetComplete && (
          <span title="Fiche produit compl\u00e8te (prix, conditionnement, zone, seuil)">
            <CheckCircle2
              className="h-4 w-4 text-emerald-500 dark:text-emerald-400 flex-shrink-0"
              strokeWidth={2.5}
            />
          </span>
        )}
      </div>
    );
  }

  // Still loading or no status computed
  if (!status || isLoadingStatuses) {
    return (
      <span className="text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
        Analyse...
      </span>
    );
  }

  // For price_alert with decision made, show "R\u00e9solu"
  if (isResolved) {
    return <ProductStatusBadge status="validated" label="R\u00e9solu" />;
  }

  const sheetComplete = isProductSheetComplete(
    status.matchedProduct as unknown as Record<string, unknown>
  );

  return (
    <div className="flex items-center gap-2">
      <ProductStatusBadge status={status.status} label={status.label} />
      {status.status === "validated" && sheetComplete && (
        <span title="Fiche produit compl\u00e8te (prix, conditionnement, zone, seuil)">
          <CheckCircle2
            className="h-4 w-4 text-emerald-500 dark:text-emerald-400 flex-shrink-0"
            strokeWidth={2.5}
          />
        </span>
      )}

      {/* Validated: edit button to correct an association */}
      {status.status === "validated" && (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => onOpenSuggestions(item, false)}
          disabled={false}
          title="Modifier le produit associ\u00e9"
          aria-label="Modifier le produit associ\u00e9"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}

      {/* Needs action: SmartMatch (if enabled) + accept, choose existing, or search all */}
      {status.status === "needs_action" && (
        <div className="flex items-center gap-1">
          {/* SmartMatch button (feature-flagged) */}
          {SMART_MATCH_ENABLED && onOpenSmartMatch && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-primary hover:text-primary/80 hover:bg-primary/10"
              onClick={() => onOpenSmartMatch(item)}
              title="SmartMatch — Recherche intelligente"
              aria-label="SmartMatch"
            >
              <Zap className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="default"
            className="h-7 w-7"
            onClick={() => {
              const idx = editableItems.findIndex((i) => i._id === item._id);
              if (idx !== -1) onAcceptAsIs(item._id, idx);
            }}
            title="Accepter tel quel (valider sans associer)"
            aria-label="Accepter tel quel"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            onClick={() => onOpenSuggestions(item, false)}
            disabled={false}
            title="Choisir un produit existant"
            aria-label="Choisir un produit existant"
          >
            <Package className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => onOpenSuggestions(item, true)}
            disabled={false}
            title="Chercher parmi TOUS les produits de ce fournisseur"
            aria-label="Rechercher dans tous les produits"
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
