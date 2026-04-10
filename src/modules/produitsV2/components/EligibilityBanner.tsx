/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE 2 — EligibilityBanner for Product Detail Page
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Red banner shown when product is not inventory-eligible.
 * Lists reasons + single CTA to open Wizard.
 */

import { AlertTriangle, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  isProductInventoryEligible,
  ELIGIBILITY_REASON_LABELS,
  type EligibilityProductInput,
} from "../utils/isProductInventoryEligible";
import type { ProductUnitContext } from "@/core/unitConversion/resolveProductUnitContext";

interface EligibilityBannerProps {
  product: EligibilityProductInput;
  unitContext: ProductUnitContext | null;
  onOpenWizard?: () => void;
}

export function EligibilityBanner({ product, unitContext, onOpenWizard }: EligibilityBannerProps) {
  const result = isProductInventoryEligible(product, unitContext);

  if (result.eligible) return null;

  return (
    <div className="rounded-lg border-2 border-destructive/50 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="text-sm font-semibold text-destructive">
            Ce produit n'apparaîtra pas dans l'inventaire
          </p>
          <div className="flex flex-wrap gap-1.5">
            {result.reasons.map((reason) => (
              <Badge
                key={reason}
                variant="outline"
                className="text-[10px] border-destructive/40 text-destructive"
              >
                {ELIGIBILITY_REASON_LABELS[reason]}
              </Badge>
            ))}
          </div>
        </div>
      </div>
      {onOpenWizard && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={onOpenWizard}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Corriger via Wizard
        </Button>
      )}
    </div>
  );
}
