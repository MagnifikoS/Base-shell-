/**
 * Page "Plats fournisseurs" — Liste des plats commerciaux suivis.
 * Le client voit UNIQUEMENT les données commerciales (nom, type, prix).
 * JAMAIS les ingrédients ni la composition interne.
 */

import { useState, useMemo } from "react";
import { useFollowedRecipes } from "../hooks/useFollowedRecipes";
import { useFollowRecipe } from "../hooks/useFollowRecipe";
import { getRecipeTypeIcon } from "@/modules/recettes";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Search, Loader2, UtensilsCrossed, X, Store, Euro } from "lucide-react";
import type { FollowedRecipe } from "../hooks/useFollowedRecipes";

export function PlatsFournisseursPage() {
  const { data: recipes, isLoading } = useFollowedRecipes();
  const { unfollow } = useFollowRecipe();
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);

  const suppliers = useMemo(() => {
    if (!recipes) return [];
    const set = new Set<string>();
    for (const r of recipes) set.add(r.supplier_name);
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [recipes]);

  const filtered = useMemo(() => {
    let list = recipes ?? [];
    if (supplierFilter) {
      list = list.filter((r) => r.supplier_name === supplierFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.recipe_name.toLowerCase().includes(q) ||
          r.supplier_name.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => a.recipe_name.localeCompare(b.recipe_name, "fr"));
  }, [recipes, search, supplierFilter]);

  const handleUnfollow = (listingId: string) => {
    unfollow.mutate(listingId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Plats fournisseurs</h1>
        <p className="text-muted-foreground mt-1">
          Plats commerciaux de vos fournisseurs partenaires
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !recipes || recipes.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <UtensilsCrossed className="h-10 w-10 mx-auto mb-4 opacity-30" />
          <p className="font-medium">Aucun plat fournisseur suivi</p>
          <p className="text-sm mt-1">
            Parcourez le catalogue recettes de vos fournisseurs partenaires pour suivre des plats.
          </p>
        </div>
      ) : (
        <>
          {/* Search + Supplier filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un plat..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {suppliers.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSupplierFilter(null)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    !supplierFilter
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  Tous
                </button>
                {suppliers.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() =>
                      setSupplierFilter(supplierFilter === name ? null : name)
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      supplierFilter === name
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <Store className="w-3 h-3" />
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Count */}
          <p className="text-sm text-muted-foreground">
            {filtered.length} plat{filtered.length > 1 ? "s" : ""} suivi{filtered.length > 1 ? "s" : ""}
          </p>

          {/* List */}
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Aucun plat trouvé
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((item) => (
                <FollowedRecipeRow
                  key={item.id}
                  item={item}
                  onUnfollow={() => handleUnfollow(item.listing_id)}
                  isPending={unfollow.isPending}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Followed recipe row ──

function FollowedRecipeRow({
  item,
  onUnfollow,
  isPending,
}: {
  item: FollowedRecipe;
  onUnfollow: () => void;
  isPending: boolean;
}) {
  const hasPortions = item.portions != null && item.portions >= 1;
  const pricePerPortion = hasPortions
    ? Math.round((item.b2b_price / item.portions!) * 100) / 100
    : null;

  const TypeIcon = item.recipe_type_icon
    ? getRecipeTypeIcon(item.recipe_type_icon)
    : null;

  return (
    <div className="flex items-center gap-3 p-4 rounded-lg border transition-colors hover:bg-accent/20">
      {/* Icon */}
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
        {TypeIcon ? (
          <TypeIcon className="w-5 h-5 text-muted-foreground" />
        ) : (
          <UtensilsCrossed className="w-5 h-5 text-muted-foreground" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate text-foreground">
            {item.recipe_name}
          </span>
          {item.recipe_type_name && (
            <Badge variant="secondary" className="text-xs shrink-0">
              {item.recipe_type_name}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Store className="w-3 h-3" />
            {item.supplier_name}
          </span>
          <span className="text-xs font-medium text-foreground flex items-center gap-1">
            <Euro className="w-3 h-3" />
            {item.b2b_price.toFixed(2)} €
          </span>
          {pricePerPortion != null && (
            <span className="text-xs text-muted-foreground">
              {pricePerPortion.toFixed(2)} € / portion
            </span>
          )}
          {hasPortions && (
            <span className="text-xs text-muted-foreground">
              {item.portions} portions
            </span>
          )}
        </div>
      </div>

      {/* Unfollow */}
      <div className="shrink-0">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive gap-1.5 text-xs"
              disabled={isPending}
            >
              <X className="w-3.5 h-3.5" />
              Retirer
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Retirer ce plat ?</AlertDialogTitle>
              <AlertDialogDescription>
                « {item.recipe_name} » de {item.supplier_name} sera retiré de vos plats fournisseurs.
                Vous pourrez le suivre à nouveau depuis le catalogue de ce fournisseur.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={onUnfollow}>
                Retirer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
