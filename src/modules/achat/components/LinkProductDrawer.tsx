/**
 * MODULE ACHAT — LinkProductDrawer
 *
 * Drawer pour lier une ligne achat "Non lié" à un produit products_v2 existant.
 * SSOT: seul purchase_line_items.product_id est modifié.
 * INTERDIT: toute écriture dans products_v2.
 *
 * ROLLBACK: Supprimer ce fichier + retirer l'import dans PurchaseSummaryTable.
 */

import { useState, useEffect, useCallback } from "react";
import { Search, Link2, Package, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLinkProduct } from "../hooks/useLinkProduct";

export interface UnlinkedLineInfo {
  productNameSnapshot: string;
  productCodeSnapshot: string | null;
  unitSnapshot: string | null;
  totalQuantity: number | null;
  totalAmount: number | null;
  supplierId: string;
  supplierName: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineInfo: UnlinkedLineInfo | null;
  establishmentId: string | undefined;
  yearMonth: string;
}

export function LinkProductDrawer({
  open,
  onOpenChange,
  lineInfo,
  establishmentId,
  yearMonth,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const { searchProducts, searchResults, isSearching, linkMutation, clearResults } =
    useLinkProduct(establishmentId);

  // Reset on open
  useEffect(() => {
    if (open && lineInfo) {
      setSearchQuery(lineInfo.productCodeSnapshot ?? lineInfo.productNameSnapshot ?? "");
      clearResults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lineInfo]);

  // Debounced search
  useEffect(() => {
    if (!open || searchQuery.trim().length < 2) {
      clearResults();
      return;
    }
    const timer = setTimeout(() => {
      searchProducts(searchQuery, lineInfo?.supplierId);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, open]);

  const handleLink = useCallback(
    async (targetProductId: string) => {
      if (!lineInfo || !establishmentId) return;
      await linkMutation.mutateAsync({
        establishmentId,
        yearMonth,
        supplierIdFilter: lineInfo.supplierId,
        productNameSnapshot: lineInfo.productNameSnapshot,
        targetProductId,
      });
      onOpenChange(false);
    },
    [lineInfo, establishmentId, yearMonth, linkMutation, onOpenChange]
  );

  if (!lineInfo) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Lier un produit
          </SheetTitle>
          <SheetDescription>Associer cette ligne achat à un produit existant</SheetDescription>
        </SheetHeader>

        {/* Infos ligne achat (lecture seule) */}
        <div className="mt-6 p-4 rounded-lg border bg-muted/30 space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Ligne achat
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Produit :</span>
              <p className="font-medium">{lineInfo.productNameSnapshot}</p>
            </div>
            {lineInfo.productCodeSnapshot && (
              <div>
                <span className="text-muted-foreground">Code :</span>
                <p className="font-medium font-mono">{lineInfo.productCodeSnapshot}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Fournisseur :</span>
              <p className="font-medium">{lineInfo.supplierName}</p>
            </div>
            {lineInfo.unitSnapshot && (
              <div>
                <span className="text-muted-foreground">Unité :</span>
                <p className="font-medium">{lineInfo.unitSnapshot}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Quantité :</span>
              <p className="font-medium">
                {lineInfo.totalQuantity?.toLocaleString("fr-FR") ?? "—"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Total :</span>
              <p className="font-medium">
                {lineInfo.totalAmount != null
                  ? `${lineInfo.totalAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`
                  : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Recherche */}
        <div className="mt-6 space-y-3">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Rechercher un produit
          </h4>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Code produit ou nom…"
              className="pl-10"
              autoFocus
            />
          </div>

          {/* Résultats */}
          <div className="space-y-1 max-h-[40vh] overflow-y-auto">
            {isSearching && (
              <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Recherche…
              </div>
            )}

            {!isSearching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
              <div className="flex flex-col items-center py-6 text-muted-foreground">
                <Package className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Aucun produit trouvé pour "{searchQuery}"</p>
              </div>
            )}

            {searchResults.map((product) => (
              <div
                key={product.id}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate uppercase">{product.nom_produit}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {product.code_produit && (
                      <Badge variant="outline" className="text-xs font-mono">
                        {product.code_produit}
                      </Badge>
                    )}
                    {/* Unit label resolved at search level — UUID hidden */}
                    {product.category && (
                      <span className="text-xs text-muted-foreground">· {product.category}</span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-2 shrink-0 gap-1"
                  disabled={linkMutation.isPending}
                  onClick={() => handleLink(product.id)}
                >
                  <Link2 className="h-3 w-3" />
                  Lier
                </Button>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
