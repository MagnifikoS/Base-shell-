/**
 * Mobile-optimized product list — card-based layout replacing the desktop table.
 */

import { useNavigate, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { ProductV2ListItem } from "../types";
import { Skeleton } from "@/components/ui/skeleton";
import { useTapGuard } from "@/hooks/useTapGuard";
import { displayProductName } from "@/utils/displayName";
import { useProductListPrices } from "../hooks/useProductListPrices";

interface MobileProductsListProps {
  products: ProductV2ListItem[];
  isLoading: boolean;
}

export function MobileProductsList({ products, isLoading }: MobileProductsListProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { onTouchStart, onTouchMove, guardedClick } = useTapGuard();
  const priceMap = useProductListPrices(products);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Aucun produit trouvé.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {products.map((product) => (
        <button
          key={product.id}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onClick={guardedClick(() => navigate(`/produits-v2/${product.id}`, { state: { from: location.pathname + location.search } }))}
          className="w-full flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 active:scale-[0.99] transition-all text-left touch-manipulation"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium uppercase leading-tight break-words">
              {displayProductName(product.nom_produit)}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {product.code_produit && (
                <span className="text-xs font-mono text-muted-foreground">
                  {product.code_produit}
                </span>
              )}
              {product.supplier_display_name && (
                <span className="text-xs text-muted-foreground truncate">
                  {product.supplier_display_name}
                </span>
              )}
            </div>
          </div>
          <span className="text-sm font-medium whitespace-nowrap">
            {priceMap.get(product.id)?.label ?? "—"}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      ))}
    </div>
  );
}
