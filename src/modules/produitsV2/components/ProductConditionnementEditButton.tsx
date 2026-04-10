/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — Bouton Édition Conditionnement (Wrapper Wizard V3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RÈGLES STRICT ISOLATION (Option B'):
 * - Utilise ProductFormV3Modal existant (même chemin)
 * - Passe existingConditionnementConfig pour pré-remplir
 * - Aucune modification de la logique VisionAI
 * - upsertProductV2() = même chemin DB
 *
 * ROLLBACK: Supprimer ce fichier + retirer l'import dans ProduitV2DetailPage
 */

import { useState, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import type { ProductV3InitialData } from "@/modules/visionAI/components/ProductFormV3/types";
import type { ProductV2 } from "../types";
import { useQueryClient } from "@tanstack/react-query";

// Lazy-load the wizard modal to break circular dependency:
// shared -> visionAI/ProductFormV3Modal -> produitsV2 -> shared
const ProductFormV3Modal = lazy(() =>
  import("@/modules/visionAI/components/ProductFormV3/ProductFormV3Modal").then((m) => ({
    default: m.ProductFormV3Modal,
  }))
);

interface ProductConditionnementEditButtonProps {
  product: ProductV2;
  supplierName?: string | null;
}

/**
 * Mappe ProductV2 (SSOT) vers ProductV3InitialData (contrat wizard)
 * ⚠️ NE PAS modifier ce mapper sans revue SSOT
 */
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
    dlc_warning_days: product.dlc_warning_days,
    allow_unit_sale: product.allow_unit_sale ?? false,
    updated_at: product.updated_at,
  };
}

export function ProductConditionnementEditButton({
  product,
  supplierName,
}: ProductConditionnementEditButtonProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const queryClient = useQueryClient();

  const handleValidated = () => {
    queryClient.invalidateQueries({ queryKey: ["product-v2", product.id] });
    queryClient.invalidateQueries({ queryKey: ["products-v2"] });
    queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
  };

  const initialData = mapProductV2ToWizardInitialData(product);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)} className="gap-2">
        <Pencil className="h-3.5 w-3.5" />
        Modifier
      </Button>

      {wizardOpen && (
        <Suspense fallback={null}>
          <ProductFormV3Modal
            open={wizardOpen}
            onOpenChange={setWizardOpen}
            initialData={initialData}
            supplierName={supplierName ?? null}
            supplierId={product.supplier_id}
            existingConditionnementConfig={product.conditionnement_config}
            onValidated={handleValidated}
            mode="edit_conditioning"
            productId={product.id}
          />
        </Suspense>
      )}
    </>
  );
}
