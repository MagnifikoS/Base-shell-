/**
 * Catalogue Recettes B2B — Composant dédié (100% isolé du catalogue produit).
 * Affiche les recettes publiées par un fournisseur partenaire.
 * Le client ne voit JAMAIS les ingrédients ni la composition interne.
 */

import { useState, useMemo } from "react";
import { useB2BRecipeCatalog } from "../hooks/useB2BRecipeCatalog";
import { useFollowRecipe } from "../hooks/useFollowRecipe";
import { getRecipeTypeIcon } from "@/modules/recettes";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, Plus, Check, Utensils } from "lucide-react";
import type { B2BRecipeCatalogItem } from "../hooks/useB2BRecipeCatalog";

interface Props {
  supplierEstablishmentId: string;
  partnershipId: string;
}

export function B2BRecipeCatalog({ supplierEstablishmentId, partnershipId }: Props) {
  const { data: recipes, isLoading } = useB2BRecipeCatalog(supplierEstablishmentId);
  const { follow, unfollow } = useFollowRecipe();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const availableTypes = useMemo(() => {
    if (!recipes) return [];
    const types = new Map<string, string>();
    for (const r of recipes) {
      if (r.recipe_type_name) types.set(r.recipe_type_name, r.recipe_type_icon ?? "");
    }
    return [...types.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));
  }, [recipes]);

  const filtered = useMemo(() => {
    let list = recipes ?? [];
    if (typeFilter) {
      list = list.filter((r) => r.recipe_type_name === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.recipe_name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => a.recipe_name.localeCompare(b.recipe_name, "fr"));
  }, [recipes, search, typeFilter]);

  const handleFollow = (item: B2BRecipeCatalogItem) => {
    follow.mutate({ listingId: item.listing_id, partnershipId });
  };

  const handleUnfollow = (item: B2BRecipeCatalogItem) => {
    unfollow.mutate(item.listing_id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!recipes || recipes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Utensils className="h-8 w-8 mx-auto mb-3 opacity-40" />
        <p>Aucune recette disponible</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search + Type filter */}
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

        {availableTypes.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setTypeFilter(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                !typeFilter
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              Tous
            </button>
            {availableTypes.map(([typeName, icon]) => {
              const IconComponent = getRecipeTypeIcon(icon);
              return (
                <button
                  key={typeName}
                  type="button"
                  onClick={() => setTypeFilter(typeFilter === typeName ? null : typeName)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    typeFilter === typeName
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {IconComponent && <IconComponent className="w-3 h-3" />}
                  {typeName}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Recipe list */}
      {filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          Aucun plat trouvé
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((item) => (
            <RecipeRow
              key={item.listing_id}
              item={item}
              onFollow={() => handleFollow(item)}
              onUnfollow={() => handleUnfollow(item)}
              isPending={follow.isPending || unfollow.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recipe row ──

function RecipeRow({
  item,
  onFollow,
  onUnfollow,
  isPending,
}: {
  item: B2BRecipeCatalogItem;
  onFollow: () => void;
  onUnfollow: () => void;
  isPending: boolean;
}) {
  const hasPortions = item.portions != null && item.portions >= 1;
  const pricePerPortion = hasPortions
    ? Math.round((item.b2b_price / item.portions!) * 100) / 100
    : null;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-accent/30">
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
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {item.b2b_price.toFixed(2)} €
          </span>
          {pricePerPortion != null && (
            <span>
              {pricePerPortion.toFixed(2)} € / portion
            </span>
          )}
          {hasPortions && (
            <span>{item.portions} portions</span>
          )}
        </div>
      </div>

      <div className="shrink-0">
        {item.is_followed ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={onUnfollow}
            disabled={isPending}
          >
            <Check className="w-3.5 h-3.5" />
            Suivi
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={onFollow}
            disabled={isPending}
          >
            <Plus className="w-3.5 h-3.5" />
            Suivre
          </Button>
        )}
      </div>
    </div>
  );
}
