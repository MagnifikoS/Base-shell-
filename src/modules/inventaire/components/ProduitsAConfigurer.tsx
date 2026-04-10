/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE 2 — "Produits à configurer" Component
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shows only misconfigured products (zone/unit/structure issues) → CTA Wizard
 * "Non initialisés" section removed — initialization handled by Wizard.
 */

import { useMemo } from "react";
import { AlertTriangle, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import type { DesktopProductStock } from "../hooks/useDesktopStock";
import { isProductInventoryEligible, ELIGIBILITY_REASON_LABELS } from "@/modules/produitsV2";
import type { EligibilityResult } from "@/modules/produitsV2";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
} from "@/core/unitConversion/resolveProductUnitContext";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";

interface IneligibleProduct {
  product: DesktopProductStock;
  result: EligibilityResult;
}

interface ProduitsAConfigurerProps {
  stock: DesktopProductStock[];
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
  estimatedStock?: Map<string, import("@/modules/stockLedger").EstimatedStockOutcome>;
}

export function ProduitsAConfigurer({ stock, dbUnits, dbConversions }: ProduitsAConfigurerProps) {
  const navigate = useNavigate();

  // ── Classify products: only misconfigured ──
  const misconfigured = useMemo(() => {
    const misconf: IneligibleProduct[] = [];

    for (const product of stock) {
      const productInput: ProductUnitInput = {
        stock_handling_unit_id: product.stock_handling_unit_id,
        final_unit_id: product.final_unit_id,
        delivery_unit_id: product.delivery_unit_id,
        supplier_billing_unit_id: product.supplier_billing_unit_id,
        conditionnement_config: product.conditionnement_config,
      };

      let unitContext;
      try {
        unitContext = resolveProductUnitContext(productInput, dbUnits, dbConversions);
      } catch {
        unitContext = null;
      }

      const result = isProductInventoryEligible(
        {
          storage_zone_id: product.storage_zone_id,
          stock_handling_unit_id: product.stock_handling_unit_id,
          archived_at: null,
        },
        unitContext
      );

      if (!result.eligible) {
        misconf.push({ product, result });
      }
    }

    return misconf;
  }, [stock, dbUnits, dbConversions]);

  // Group misconfigured by zone
  const groupedMisconfigured = useMemo(() => {
    const map = new Map<string, { zoneName: string; items: IneligibleProduct[] }>();
    for (const item of misconfigured) {
      const key = item.product.storage_zone_id ?? "__no_zone__";
      const zoneName = item.product.storage_zone_name ?? "Sans zone";
      if (!map.has(key)) map.set(key, { zoneName, items: [] });
      map.get(key)!.items.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].zoneName.localeCompare(b[1].zoneName));
  }, [misconfigured]);

  if (misconfigured.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* ══════ Produits mal configurés ══════ */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Produits mal configurés ({misconfigured.length})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Ces produits ne peuvent pas être comptés en inventaire. Corrigez-les via le Wizard.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {groupedMisconfigured.map(([zoneKey, { zoneName, items }]) => (
            <div key={zoneKey} className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {zoneName} ({items.length})
              </h4>
              <div className="space-y-1.5">
                {items.map(({ product, result }) => (
                  <div
                    key={product.product_id}
                    className="flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate uppercase">{product.nom_produit}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1.5 text-xs"
                      onClick={() => navigate(`/produits-v2/${product.product_id}`)}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Corriger via Wizard
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
