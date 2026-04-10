/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE 1 + PHASE 4 — Suggestions simples + THE BRAIN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * DÉCLENCHEMENT: Ligne "Nouveau produit" AVEC fournisseur ET catégorie identifiés
 *
 * RÈGLES:
 * - Aucun auto-link
 * - Aucun scoring Levenshtein
 * - Aucun tri "intelligent"
 * - L'utilisateur choisit manuellement
 *
 * PHASE 4 (THE BRAIN):
 * - Si une règle existe (≥2 confirmations, 0 correction) → afficher en premier
 * - Label: "Basé sur vos validations précédentes"
 * - Toujours manuel, jamais automatique
 *
 * COMPORTEMENT:
 * - Sélection → enregistre dans confirmedMatches (UI-only)
 * - Recalcul statut via moteur existant
 * - Aucune création DB
 * - Aucune modification produit
 */

import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Package, Wand2, Brain, Sparkles, Search } from "lucide-react";
import type { ProductV2 } from "@/modules/produitsV2";
import { getBestProductRuleSuggestion, type BrainProductSuggestion } from "@/modules/theBrain";
import { useUnits } from "@/hooks/useUnits";

interface ExistingProductSuggestionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nom du produit recherché (extrait de la facture) */
  searchedProductName: string | null;
  /** Nom du fournisseur (session header) */
  supplierName: string | null;
  /** Catégorie extraite par Vision AI */
  category: string | null;
  /** Liste des produits V2 actifs */
  productsV2: ProductV2[];
  /** Callback quand l'utilisateur sélectionne un produit */
  onSelectProduct: (productId: string) => void;
  /** Callback pour créer un nouveau produit (ouvre V3 Wizard) */
  onCreateNew: () => void;
  disabled?: boolean;
  /** Phase 4: ID établissement pour chercher les règles THE BRAIN */
  establishmentId?: string;
  /** Phase 4: ID fournisseur pour chercher les règles THE BRAIN */
  supplierId?: string | null;
  /**
   * Plan B: Skip category filter — show ALL products from this supplier
   * Used when category was incorrectly classified by Vision AI
   */
  skipCategoryFilter?: boolean;
}

export function ExistingProductSuggestions({
  open,
  onOpenChange,
  searchedProductName,
  supplierName,
  category,
  productsV2,
  onSelectProduct,
  onCreateNew,
  disabled = false,
  establishmentId,
  supplierId,
  skipCategoryFilter = false,
}: ExistingProductSuggestionsProps) {
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4 — THE BRAIN suggestion
  // ═══════════════════════════════════════════════════════════════════════════
  const [brainSuggestion, setBrainSuggestion] = useState<BrainProductSuggestion | null>(null);
  const [brainProduct, setBrainProduct] = useState<ProductV2 | null>(null);
  const [_isFetchingBrain, setIsFetchingBrain] = useState(false);

  // Barre de recherche pour filtrer la liste
  const [searchQuery, setSearchQuery] = useState("");

  // Reset search query when dialog opens
  useEffect(() => {
    if (open) setSearchQuery("");
  }, [open]);

  // SSOT: resolve unit label from UUID
  const { units: dbUnits } = useUnits();
  const getUnitLabel = (unitId: string | null | undefined): string => {
    if (!unitId) return "u.";
    const u = dbUnits.find((unit) => unit.id === unitId);
    return u?.abbreviation ?? "u.";
  };

  // Fetch THE BRAIN suggestion when modal opens
  // PLAN B: En mode skipCategoryFilter, on cherche les règles sans catégorie
  useEffect(() => {
    if (!open || !establishmentId || !searchedProductName) {
      setBrainSuggestion(null);
      setBrainProduct(null);
      return;
    }

    let cancelled = false;
    setIsFetchingBrain(true);

    getBestProductRuleSuggestion({
      establishmentId,
      supplierId,
      // PLAN B: Si skipCategoryFilter, chercher les règles category=null
      category: skipCategoryFilter ? null : category,
      label: searchedProductName,
    })
      .then((suggestion) => {
        if (cancelled) return;
        setBrainSuggestion(suggestion);

        // Si on a une suggestion, trouver le produit correspondant
        if (suggestion) {
          const product = productsV2.find((p) => p.id === suggestion.productId);
          setBrainProduct(product ?? null);
        } else {
          setBrainProduct(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBrainSuggestion(null);
          setBrainProduct(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsFetchingBrain(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    establishmentId,
    supplierId,
    category,
    searchedProductName,
    productsV2,
    skipCategoryFilter,
  ]);

  // Filtrer les produits par fournisseur + catégorie (case-insensitive)
  // Plan B: skipCategoryFilter = true → ignorer le filtre catégorie
  const suggestions = useMemo(() => {
    if (!supplierName) return [];
    // If not skipping category and no category → empty (need category for normal mode)
    if (!skipCategoryFilter && !category) return [];

    const normalizedSupplier = supplierName.toLowerCase().trim();
    const normalizedCategory = category?.toLowerCase().trim() ?? "";
    const normalizedSearch = searchQuery.toLowerCase().trim();

    return productsV2.filter((product) => {
      // Exclure le produit déjà suggéré par THE BRAIN
      if (brainProduct && product.id === brainProduct.id) return false;

      // Match fournisseur par supplierId (SSOT) — on ne filtre plus par texte
      if (supplierId && product.supplier_id !== supplierId) return false;
      // Fallback: if no supplierId prop, skip supplier filtering
      if (!supplierId) return false;

      // Plan B: skip category filter → show all products from this supplier
      const productCategory = (product.category ?? "").toLowerCase().trim();
      const categoryMatches = skipCategoryFilter
        ? true
        : productCategory === normalizedCategory ||
          productCategory.includes(normalizedCategory) ||
          normalizedCategory.includes(productCategory);

      if (!categoryMatches) return false;

      // Filtre par barre de recherche
      if (normalizedSearch) {
        const productName = (product.nom_produit ?? "").toLowerCase();
        const productCode = (product.code_produit ?? "").toLowerCase();
        return productName.includes(normalizedSearch) || productCode.includes(normalizedSearch);
      }

      return true;
    });
  }, [supplierName, category, productsV2, brainProduct, skipCategoryFilter, searchQuery]);

  const handleSelect = (productId: string) => {
    onSelectProduct(productId);
    onOpenChange(false);
  };

  const handleCreateNew = () => {
    onCreateNew();
    onOpenChange(false);
  };

  const hasSuggestions = suggestions.length > 0;
  const hasBrainSuggestion = brainSuggestion && brainProduct;
  // Plan B mode: show if we have supplier (category not required)
  const canShowSuggestions = skipCategoryFilter ? !!supplierName : !!supplierName && !!category;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg h-[70vh] flex flex-col overflow-hidden min-h-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {skipCategoryFilter
              ? "Tous les produits de ce fournisseur"
              : "Produits existants chez ce fournisseur"}
          </DialogTitle>
          {searchedProductName && (
            <div className="mt-2 p-3 bg-muted/50 rounded-lg border">
              <p className="text-xs text-muted-foreground">Produit recherché :</p>
              <p className="font-semibold text-base">{searchedProductName}</p>
            </div>
          )}
          {canShowSuggestions && !skipCategoryFilter && (
            <DialogDescription className="pt-2">
              Catégorie : <span className="font-medium text-foreground">{category}</span>
            </DialogDescription>
          )}
          {skipCategoryFilter && (
            <DialogDescription className="pt-2 text-warning">
              Recherche élargie (toutes catégories)
            </DialogDescription>
          )}

          {/* Barre de recherche */}
          {canShowSuggestions && (
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un produit..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                aria-label="Rechercher un produit"
              />
            </div>
          )}
        </DialogHeader>

        {/* Pas assez d'infos pour suggérer */}
        {!canShowSuggestions && !hasBrainSuggestion && (
          <div className="py-8 text-center text-muted-foreground">
            <p className="text-sm">
              Suggestions indisponibles (fournisseur ou catégorie non identifiés)
            </p>
            <Button onClick={handleCreateNew} className="mt-4" disabled={disabled}>
              <Wand2 className="h-4 w-4 mr-2" />
              Créer un nouveau produit
            </Button>
          </div>
        )}

        {/* Aucun produit trouvé ET pas de suggestion THE BRAIN */}
        {canShowSuggestions && !hasSuggestions && !hasBrainSuggestion && (
          <div className="py-8 text-center text-muted-foreground">
            <p className="text-sm">
              Aucun produit existant pour ce fournisseur dans cette catégorie.
            </p>
            <Button onClick={handleCreateNew} className="mt-4" disabled={disabled}>
              <Wand2 className="h-4 w-4 mr-2" />
              Créer un nouveau produit
            </Button>
          </div>
        )}

        {/* Liste des suggestions (avec THE BRAIN en premier) */}
        {(canShowSuggestions && hasSuggestions) || hasBrainSuggestion ? (
          <>
            <ScrollArea className="flex-1 min-h-0 pr-4">
              <div className="space-y-3">
                {/* ════════════════════════════════════════════════════════════
                    PHASE 4 — THE BRAIN suggestion (toujours en premier)
                    ════════════════════════════════════════════════════════════ */}
                {hasBrainSuggestion && brainProduct && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-primary">
                      <Brain className="h-3.5 w-3.5" />
                      <span>Suggestion THE BRAIN</span>
                      <Sparkles className="h-3 w-3 text-warning" />
                    </div>
                    <div className="p-3 rounded-lg border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate uppercase">{brainProduct.nom_produit}</p>
                          <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                            {brainProduct.code_produit && (
                              <span className="font-mono">Code: {brainProduct.code_produit}</span>
                            )}
                            {brainProduct.conditionnement_resume && (
                              <span>{brainProduct.conditionnement_resume}</span>
                            )}
                            {brainProduct.final_unit_price != null && (
                              <span className="tabular-nums">
                                {brainProduct.final_unit_price.toFixed(2)} €/
                                {getUnitLabel(brainProduct.final_unit_id)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5 italic">
                            Basé sur vos validations précédentes (
                            {brainSuggestion.confirmationsCount}× confirmé)
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleSelect(brainProduct.id)}
                          disabled={disabled}
                        >
                          Sélectionner
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Séparateur si on a THE BRAIN + autres suggestions */}
                {hasBrainSuggestion && hasSuggestions && (
                  <div className="flex items-center gap-2 pt-2 pb-1">
                    <div className="flex-1 border-t" />
                    <span className="text-xs text-muted-foreground">Autres produits</span>
                    <div className="flex-1 border-t" />
                  </div>
                )}

                {/* ════════════════════════════════════════════════════════════
                    PHASE 1 — Suggestions classiques (fournisseur + catégorie)
                    ════════════════════════════════════════════════════════════ */}
                {suggestions.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate uppercase">{product.nom_produit}</p>
                      <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                        {product.code_produit && (
                          <span className="font-mono">Code: {product.code_produit}</span>
                        )}
                        {product.conditionnement_resume && (
                          <span>{product.conditionnement_resume}</span>
                        )}
                        {product.final_unit_price != null && (
                          <span className="tabular-nums">
                            {product.final_unit_price.toFixed(2)} €/
                            {getUnitLabel(product.final_unit_id)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSelect(product.id)}
                      disabled={disabled}
                    >
                      Sélectionner
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="pt-4 border-t">
              <Button
                variant="secondary"
                className="w-full"
                onClick={handleCreateNew}
                disabled={disabled}
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Créer un nouveau produit
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
