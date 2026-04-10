/**
 * B2B Product Fix Dialog — Allows correcting blocked category or unit
 * before import. Pure UI, no DB mutation — returns override to parent.
 */

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Tag, Ruler } from "lucide-react";
import type { EnrichedCatalogProduct, LocalUnit, LocalCategory } from "../services/b2bTypes";

/** Override that the parent will store and apply at import time */
export interface ProductOverride {
  productId: string;
  categoryId?: string | null;
  categoryName?: string | null;
  unitOverrides?: Record<string, string>; // sourceUnitId → localUnitId
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: EnrichedCatalogProduct | null;
  localCategories: LocalCategory[];
  localUnits: LocalUnit[];
  onApply: (override: ProductOverride) => void;
}

export function B2BProductFixDialog({
  open,
  onOpenChange,
  product,
  localCategories,
  localUnits,
  onApply,
}: Props) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [unitSelections, setUnitSelections] = useState<Record<string, string>>({});
  const [lastProductId, setLastProductId] = useState<string | null>(null);

  // Reset state when product changes
  const productId = product?.id ?? null;
  if (productId && productId !== lastProductId) {
    setLastProductId(productId);
    setSelectedCategoryId(null);
    setUnitSelections({});
  }

  const isCategoryBlocked = product?.importStatus === "BLOCKED_CATEGORY";
  const isUnitBlocked =
    product?.importStatus === "BLOCKED_UNIT_UNKNOWN" ||
    product?.importStatus === "BLOCKED_UNIT_AMBIGUOUS" ||
    product?.importStatus === "BLOCKED_UNIT_FAMILY_MISMATCH";

  // Blocked units that need resolution
  const blockedUnits = useMemo(
    () => (product?.unitMappings ?? []).filter(
      (m) => m.status === "UNKNOWN" || m.status === "AMBIGUOUS"
    ),
    [product?.unitMappings]
  );

  // Active categories only
  const activeCategories = useMemo(
    () => localCategories.filter((c) => !c.is_archived),
    [localCategories]
  );

  // For unit suggestions: group by family for smarter display
  const unitsByFamily = useMemo(() => {
    const map = new Map<string, LocalUnit[]>();
    for (const u of localUnits) {
      const key = u.family ?? "other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(u);
    }
    return map;
  }, [localUnits]);

  const getFilteredUnits = (sourceFamily: string | null) => {
    if (!sourceFamily) return localUnits;
    const sameFam = unitsByFamily.get(sourceFamily) ?? [];
    return sameFam.length > 0 ? [...sameFam, ...localUnits.filter((u) => u.family !== sourceFamily)] : localUnits;
  };

  if (!product) return null;

  const canApply = () => {
    if (isCategoryBlocked && !selectedCategoryId) return false;
    if (isUnitBlocked) {
      return blockedUnits.every((bu) => !!unitSelections[bu.sourceUnitId]);
    }
    return true;
  };

  const handleApply = () => {
    const override: ProductOverride = { productId: product.id };

    if (isCategoryBlocked && selectedCategoryId) {
      const cat = activeCategories.find((c) => c.id === selectedCategoryId);
      override.categoryId = selectedCategoryId;
      override.categoryName = cat?.name ?? null;
    }

    if (isUnitBlocked && Object.keys(unitSelections).length > 0) {
      override.unitOverrides = { ...unitSelections };
    }

    onApply(override);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Corriger ce produit
          </DialogTitle>
          <DialogDescription>
            Résolvez les incompatibilités pour pouvoir importer ce produit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Product name */}
          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="font-medium text-sm uppercase">{product.nom_produit}</p>
            {product.code_produit && (
              <p className="text-xs text-muted-foreground mt-0.5">Code : {product.code_produit}</p>
            )}
          </div>

          {/* Category fix */}
          {isCategoryBlocked && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-destructive" />
                <span className="text-sm font-medium">Catégorie bloquée</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Le fournisseur utilise la catégorie « {product.category_name ?? "inconnue"} »
                qui n'existe pas dans votre établissement.
                Choisissez une de vos catégories.
              </p>
              <Select
                value={selectedCategoryId ?? ""}
                onValueChange={(v) => setSelectedCategoryId(v || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une catégorie…" />
                </SelectTrigger>
                <SelectContent>
                  {activeCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Unit fix */}
          {isUnitBlocked && blockedUnits.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Ruler className="h-4 w-4 text-destructive" />
                <span className="text-sm font-medium">Unité bloquée</span>
              </div>
              {blockedUnits.map((bu) => {
                const filteredUnits = getFilteredUnits(bu.sourceUnit.family);
                return (
                  <div key={bu.sourceUnitId} className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Le fournisseur utilise l'unité « {bu.sourceUnit.name} ({bu.sourceUnit.abbreviation}) »
                      {bu.sourceUnit.family ? ` (famille : ${bu.sourceUnit.family})` : ""}.
                      {bu.status === "AMBIGUOUS"
                        ? " Plusieurs correspondances possibles."
                        : " Cette unité n'existe pas chez vous."
                      }
                      {" "}Choisissez l'unité équivalente.
                    </p>
                    <Select
                      value={unitSelections[bu.sourceUnitId] ?? ""}
                      onValueChange={(v) =>
                        setUnitSelections((prev) => ({ ...prev, [bu.sourceUnitId]: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choisir une unité…" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredUnits.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name} ({u.abbreviation})
                            {u.family ? ` — ${u.family}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          )}

          {/* Already corrected indicator */}
          {!isCategoryBlocked && !isUnitBlocked && (
            <p className="text-sm text-muted-foreground">
              Ce produit n'a pas de blocage à corriger.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleApply} disabled={!canApply()}>
            Appliquer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
