/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — IngredientForm (reusable)
 * ═══════════════════════════════════════════════════════════════
 *
 * Used in:
 * - Wizard Step 2 (creation)
 * - Add ingredient from recipe detail
 * - Edit ingredient popup
 *
 * Rules:
 * - Product = search selector (no free text)
 * - Quantity = numeric input
 * - Unit = chips ALWAYS (never select dropdown)
 * - Even 1 unit → chip still visible
 * - If allowPreparations=true, search also shows preparations with badge
 */

import { useState, useEffect, useMemo } from "react";
import { normalizeSearch } from "@/utils/normalizeSearch";
import { Input } from "@/components/ui/input";
import { Search, ChevronRight, Beaker } from "lucide-react";
import { useProductsV2 } from "@/modules/produitsV2";
import { usePreparations } from "../hooks/usePreparations";
import { useProductUnitsForRecipe } from "../hooks/useProductUnitsForRecipe";
import { usePreparationYieldUnit } from "../hooks/usePreparationYieldUnit";
import { displayUnitName } from "@/lib/units/displayUnitName";

export interface IngredientFormValue {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_id: string;
  unit_label: string;
  /** Set when the ingredient is a sub-recipe (preparation) */
  sub_recipe_id?: string;
}

interface IngredientFormProps {
  /** Pre-filled values for edit mode */
  initial?: Partial<IngredientFormValue>;
  /** Called when all fields are valid */
  onSubmit: (value: IngredientFormValue) => void;
  /** Submit button label */
  submitLabel?: string;
  /** Whether to show preparations in search results (false for preparation recipes) */
  allowPreparations?: boolean;
}

interface SearchResult {
  id: string;
  name: string;
  isPreparation: boolean;
  yieldUnitId?: string | null;
}

export function IngredientForm({
  initial,
  onSubmit,
  submitLabel = "Ajouter",
  allowPreparations = false,
}: IngredientFormProps) {
  const { products } = useProductsV2();
  const { preparations } = usePreparations();

  // ── State ──
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    initial?.product_id ?? null
  );
  const [selectedSubRecipeId, setSelectedSubRecipeId] = useState<string | null>(
    initial?.sub_recipe_id ?? null
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [showSearch, setShowSearch] = useState(!initial?.product_id && !initial?.sub_recipe_id);
  const [quantity, setQuantity] = useState(
    initial?.quantity?.toString() ?? ""
  );
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(
    initial?.unit_id ?? null
  );

  const isSubRecipe = !!selectedSubRecipeId;
  const activeId = isSubRecipe ? selectedSubRecipeId : selectedProductId;

  const { exposedUnits, defaultUnitId, isLoading: unitsLoading } =
    useProductUnitsForRecipe(isSubRecipe ? null : selectedProductId);

  // For sub-recipes: use the yield unit + physical siblings
  const { yieldUnit, yieldUnits, isLoading: yieldUnitLoading } =
    usePreparationYieldUnit(isSubRecipe ? selectedSubRecipeId : null);

  const effectiveUnits = isSubRecipe
    ? yieldUnits
    : exposedUnits;

  const effectiveDefaultUnitId = isSubRecipe
    ? (yieldUnit?.id ?? null)
    : defaultUnitId;

  const effectiveUnitsLoading = isSubRecipe ? yieldUnitLoading : unitsLoading;

  // Auto-select default unit when product changes
  useEffect(() => {
    if (effectiveUnits.length === 0) return;
    if (selectedUnitId && effectiveUnits.some((u) => u.id === selectedUnitId)) return;
    setSelectedUnitId(effectiveDefaultUnitId);
  }, [effectiveUnits, effectiveDefaultUnitId, selectedUnitId]);

  // ── Product/preparation search ──
  const filtered = useMemo((): SearchResult[] => {
    if (!searchTerm.trim()) return [];
    const term = normalizeSearch(searchTerm);
    const results: SearchResult[] = [];

    // Products
    const matchedProducts = products
      .filter((p) => normalizeSearch(p.nom_produit).includes(term))
      .slice(0, 15);
    for (const p of matchedProducts) {
      results.push({ id: p.id, name: p.nom_produit, isPreparation: false });
    }

    // Preparations (if allowed)
    if (allowPreparations) {
      const matchedPreps = preparations
        .filter((r) => normalizeSearch(r.name).includes(term))
        .slice(0, 10);
      for (const r of matchedPreps) {
        results.push({
          id: r.id,
          name: r.name,
          isPreparation: true,
          yieldUnitId: r.yield_unit_id,
        });
      }
    }

    return results.slice(0, 20);
  }, [products, preparations, searchTerm, allowPreparations]);

  const selectedName = useMemo(() => {
    if (selectedSubRecipeId) {
      return preparations.find((r) => r.id === selectedSubRecipeId)?.name ?? "—";
    }
    return products.find((p) => p.id === selectedProductId)?.nom_produit ?? "—";
  }, [products, preparations, selectedProductId, selectedSubRecipeId]);

  const handleSelectItem = (item: SearchResult) => {
    if (item.isPreparation) {
      setSelectedSubRecipeId(item.id);
      setSelectedProductId(null);
    } else {
      setSelectedProductId(item.id);
      setSelectedSubRecipeId(null);
    }
    setShowSearch(false);
    setSearchTerm("");
    // Reset unit when changing selection
    if (item.id !== initial?.product_id && item.id !== initial?.sub_recipe_id) {
      setSelectedUnitId(null);
    }
  };

  const handleSubmit = () => {
    if (!activeId || !selectedUnitId || !quantity) return;
    const q = parseFloat(quantity);
    if (isNaN(q) || q <= 0) return;
    const unit = effectiveUnits.find((u) => u.id === selectedUnitId);
    onSubmit({
      product_id: isSubRecipe ? "" : selectedProductId!,
      product_name: selectedName,
      quantity: q,
      unit_id: selectedUnitId,
      unit_label: unit ? displayUnitName(unit) : "",
      sub_recipe_id: isSubRecipe ? selectedSubRecipeId! : undefined,
    });
  };

  const isValid =
    !!activeId &&
    !!selectedUnitId &&
    !!quantity &&
    parseFloat(quantity) > 0;

  return (
    <div className="space-y-5">
      {/* ── Product / preparation selection ── */}
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block">
          {allowPreparations ? "Produit ou préparation" : "Produit"}
        </label>
        {showSearch ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={allowPreparations ? "Rechercher produit ou préparation…" : "Rechercher un produit…"}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-11"
                autoFocus
              />
            </div>
            <div className="max-h-52 overflow-y-auto rounded-lg border border-border bg-card">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  Aucun résultat
                </p>
              ) : (
                filtered.map((item, i) => (
                  <button
                    key={`${item.isPreparation ? "prep" : "prod"}-${item.id}`}
                    type="button"
                    className={`w-full text-left px-4 min-h-[44px] flex items-center gap-2 text-sm
                               hover:bg-accent/50 transition-colors active:bg-accent
                               ${i > 0 ? "border-t border-border" : ""}`}
                    onClick={() => handleSelectItem(item)}
                  >
                    {item.isPreparation && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent text-[10px] font-semibold text-accent-foreground shrink-0">
                        <Beaker className="w-3 h-3" />
                        PRÉPA
                      </span>
                    )}
                    <span className="truncate">{item.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowSearch(true)}
            className="w-full text-left rounded-lg border border-border bg-card px-4 min-h-[44px]
                       flex items-center justify-between
                       hover:bg-accent/50 transition-colors active:scale-[0.99]"
          >
            <div className="flex items-center gap-2 min-w-0">
              {isSubRecipe && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent text-[10px] font-semibold text-accent-foreground shrink-0">
                  <Beaker className="w-3 h-3" />
                  PRÉPA
                </span>
              )}
              <span className="font-medium text-foreground truncate">
                {selectedName}
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
          </button>
        )}
      </div>

      {/* ── Quantity ── */}
      {activeId && (
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block">
            Quantité
          </label>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            placeholder="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="text-center text-lg font-semibold h-12"
          />
        </div>
      )}

      {/* ── Unit chips (ALWAYS chips, never select) ── */}
      {activeId && (
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block">
            Unité
          </label>
          {effectiveUnitsLoading ? (
            <div className="flex gap-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 w-16 rounded-full bg-muted/50 animate-pulse"
                />
              ))}
            </div>
          ) : effectiveUnits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune unité configurée
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {effectiveUnits.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => setSelectedUnitId(unit.id)}
                  className={`
                    min-h-[40px] px-5 py-2 rounded-full text-sm font-medium 
                    transition-all active:scale-95
                    ${
                      selectedUnitId === unit.id
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }
                  `}
                >
                  {displayUnitName(unit)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Submit ── */}
      {activeId && (
        <button
          type="button"
          disabled={!isValid}
          onClick={handleSubmit}
          className="w-full rounded-lg bg-primary text-primary-foreground min-h-[44px] py-3
                     font-medium text-sm transition-all
                     disabled:opacity-40 disabled:cursor-not-allowed
                     active:scale-[0.98]"
        >
          {submitLabel}
        </button>
      )}
    </div>
  );
}
