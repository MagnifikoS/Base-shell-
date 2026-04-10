import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Package } from "lucide-react";

interface FilteredProductsBannerProps {
  filteredOutCount: number;
  showFiltered: boolean;
  onToggle: () => void;
}

/**
 * Banner affichant le nombre de produits masqués (déjà existants).
 * Toggle pour les afficher/masquer.
 */
export function FilteredProductsBanner({
  filteredOutCount,
  showFiltered,
  onToggle,
}: FilteredProductsBannerProps) {
  if (filteredOutCount === 0) return null;

  return (
    <div className="flex items-center justify-between gap-4 p-3 bg-muted/50 border rounded-lg">
      <div className="flex items-center gap-2 text-sm">
        <Package className="h-4 w-4 text-muted-foreground" />
        <span>
          <strong>{filteredOutCount}</strong> produit{filteredOutCount > 1 ? "s" : ""} déjà
          enregistré{filteredOutCount > 1 ? "s" : ""}
          {showFiltered ? " affiché" : " masqué"}
          {filteredOutCount > 1 ? "s" : ""}
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={onToggle} className="gap-2 text-xs">
        {showFiltered ? (
          <>
            <EyeOff className="h-3.5 w-3.5" />
            Masquer
          </>
        ) : (
          <>
            <Eye className="h-3.5 w-3.5" />
            Afficher quand même
          </>
        )}
      </Button>
    </div>
  );
}
