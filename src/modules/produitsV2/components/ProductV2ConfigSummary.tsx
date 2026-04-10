/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — ProductV2ConfigSummary Component
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Displays conditioning configuration summary in detail page.
 * Card is clickable when product is provided to open edit wizard.
 */

import React, { useState, lazy, Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConditioningConfig, ProductV2 } from "../types";
import type { ProductV3InitialData } from "@/modules/visionAI/components/ProductFormV3/types";
import { useQueryClient } from "@tanstack/react-query";

// Lazy-load the wizard modal to break circular dependency:
// shared -> visionAI/ProductFormV3Modal -> produitsV2 -> shared
const ProductFormV3Modal = lazy(() =>
  import("@/modules/visionAI/components/ProductFormV3/ProductFormV3Modal").then((m) => ({
    default: m.ProductFormV3Modal,
  }))
);

interface ProductV2ConfigSummaryProps {
  config: ConditioningConfig | null;
  resume: string | null;
  /** Si fourni, la carte devient cliquable pour ouvrir le Wizard V3 */
  product?: ProductV2 | null;
  /** Pour le mode création : données du formulaire en cours */
  formInitialData?: ProductV3InitialData | null;
  /** Supplier name for wizard display */
  supplierName?: string | null;
  /** Supplier ID from form (creation) or product (edit) */
  supplierId?: string | null;
  /** Callback after wizard validation (e.g. redirect after create) */
  onWizardValidated?: () => void;
  /** Auto-open wizard on mount (e.g. for /produits-v2/new) */
  autoOpen?: boolean;
}

function mapProductV2ToWizardInitialData(product: ProductV2): ProductV3InitialData {
  return {
    nom_produit: product.nom_produit,
    code_produit: product.code_produit,
    info_produit: product.info_produit,
    quantite_commandee: product.supplier_billing_quantity ?? null,
    prix_total_ligne: product.supplier_billing_line_total ?? null,
    unite_facturee: null, // SSOT: resolved via unite_facturee_id only
    unite_facturee_id: product.supplier_billing_unit_id,
    
    vai_category: null, // SSOT: resolved from vai_category_id only
    vai_category_id: product.category_id,
    // Step 4 — Management units
    delivery_unit_id: product.delivery_unit_id,
    stock_handling_unit_id: product.stock_handling_unit_id,
    kitchen_unit_id: product.kitchen_unit_id,
    price_display_unit_id: product.price_display_unit_id,
    // Step 5 — Stock & classification
    storage_zone_id: product.storage_zone_id,
    min_stock_quantity_canonical: product.min_stock_quantity_canonical,
    min_stock_unit_id: product.min_stock_unit_id,
    barcode: product.code_barres,
    allow_unit_sale: product.allow_unit_sale ?? false,
    updated_at: product.updated_at,
  };
}

export function ProductV2ConfigSummary({
  config,
  resume,
  product,
  formInitialData,
  supplierName,
  supplierId,
  onWizardValidated,
  autoOpen,
}: ProductV2ConfigSummaryProps) {
  const [wizardOpen, setWizardOpen] = useState(autoOpen ?? false);
  const queryClient = useQueryClient();

  const isClickable = !!product || !!formInitialData;

  const handleCardClick = () => {
    if (isClickable) {
      setWizardOpen(true);
    }
  };

  const wizardInitialData = product
    ? mapProductV2ToWizardInitialData(product)
    : (formInitialData ?? null);

  const wizardSupplierName = supplierName ?? null; // SSOT: no legacy supplier_name fallback

  const handleValidated = () => {
    if (product) {
      queryClient.invalidateQueries({ queryKey: ["product-v2", product.id] });
      queryClient.invalidateQueries({ queryKey: ["products-v2"] });
    }
    onWizardValidated?.();
  };

  const cardClassName = cn(isClickable && "cursor-pointer transition-colors hover:bg-muted/50");

  if (!config && !resume) {
    return (
      <>
        <Card
          className={cardClassName}
          onClick={handleCardClick}
          {...(isClickable
            ? {
                role: "button",
                tabIndex: 0,
                "aria-label": "Modifier le conditionnement",
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleCardClick();
                  }
                },
              }
            : {})}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4" />
              Conditionnement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Aucune configuration de conditionnement définie.
            </p>
          </CardContent>
        </Card>

        {wizardOpen && wizardInitialData && (
          <Suspense fallback={null}>
            <ProductFormV3Modal
              open={wizardOpen}
              onOpenChange={setWizardOpen}
              initialData={wizardInitialData}
              supplierName={wizardSupplierName}
              existingConditionnementConfig={config}
              mode={product ? "edit_conditioning" : "creation"}
              productId={product?.id ?? null}
              supplierId={supplierId ?? product?.supplier_id ?? null}
              onValidated={handleValidated}
            />
          </Suspense>
        )}
      </>
    );
  }

  return (
    <>
      <Card
        className={cardClassName}
        onClick={handleCardClick}
        {...(isClickable
          ? {
              role: "button",
              tabIndex: 0,
              "aria-label": "Modifier le conditionnement",
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardClick();
                }
              },
            }
          : {})}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Conditionnement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {resume && <p className="text-sm font-medium">{resume}</p>}

          {config && (
            <div className="space-y-3 text-sm">
              {config.finalUnit && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Unité finale :</span>
                  <Badge variant="secondary">{config.finalUnit}</Badge>
                </div>
              )}

              {config.packagingLevels && config.packagingLevels.length > 0 && (
                <div className="space-y-1">
                  <span className="text-muted-foreground">Niveaux :</span>
                  <ul className="ml-4 space-y-1">
                    {config.packagingLevels.map((level, i) => (
                      <li key={level.id || i} className="flex items-center gap-2">
                        <span className="text-muted-foreground">{i + 1}.</span>
                        <span>{level.type}</span>
                        {level.containsQuantity && level.containsUnit && (
                          <span className="text-muted-foreground">
                            ({level.containsQuantity} {level.containsUnit})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {config.equivalence && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Équivalence :</span>
                  <span>
                    {config.equivalence.quantity} {config.equivalence.unit} = 1{" "}
                    {config.equivalence.source}
                  </span>
                </div>
              )}

              {config.priceLevel && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Ancrage prix :</span>
                  <Badge variant="outline">{config.priceLevel.label}</Badge>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {wizardOpen && wizardInitialData && (
        <Suspense fallback={null}>
          <ProductFormV3Modal
            open={wizardOpen}
            onOpenChange={setWizardOpen}
            initialData={wizardInitialData}
            supplierName={wizardSupplierName}
            existingConditionnementConfig={config}
            mode={product ? "edit_conditioning" : "creation"}
            productId={product?.id ?? null}
            supplierId={supplierId ?? product?.supplier_id ?? null}
            onValidated={handleValidated}
          />
        </Suspense>
      )}
    </>
  );
}
