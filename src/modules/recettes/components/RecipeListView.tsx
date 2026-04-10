/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Recipe list view (filterable + searchable)
 * ═══════════════════════════════════════════════════════════════
 */

import { useState, useMemo } from "react";
import { BookOpen, ChevronRight, Beaker } from "lucide-react";
import { useRecipes } from "@/modules/recettes";
import type { Recipe } from "@/modules/recettes";
import { RecipeDetail } from "./RecipeDetail";

interface RecipeListViewProps {
  filterTypeId: string | null;
  searchQuery?: string;
  isLoading: boolean;
}

export function RecipeListView({ filterTypeId, searchQuery = "", isLoading }: RecipeListViewProps) {
  const { recipes, isLoading: recipesLoading } = useRecipes();
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

  const loading = isLoading || recipesLoading;

  const filtered = useMemo(() => {
    let list = recipes;
    if (filterTypeId) {
      list = list.filter((r) => r.recipe_type_id === filterTypeId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q));
    }
    return list;
  }, [recipes, filterTypeId, searchQuery]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[4.5rem] rounded-xl bg-muted/40 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-full bg-muted/60 flex items-center justify-center mb-4">
          <BookOpen className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground text-sm">
          {searchQuery.trim() || filterTypeId
            ? "Aucune recette trouvée"
            : "Aucune recette pour l'instant"}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {filtered.map((recipe: Recipe) => (
          <button
            key={recipe.id}
            onClick={() => setSelectedRecipeId(recipe.id)}
            className="w-full text-left rounded-xl border border-border/60 bg-card p-4
                       hover:bg-accent/30 hover:border-border transition-all active:scale-[0.99]
                       shadow-[0_1px_3px_0_hsl(var(--foreground)/0.04)]"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {recipe.is_preparation && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent text-[10px] font-semibold text-accent-foreground shrink-0">
                      <Beaker className="w-3 h-3" />
                      PRÉPA
                    </span>
                  )}
                  <p className="font-medium text-foreground truncate">
                    {recipe.name}
                  </p>
                </div>
                {!recipe.is_preparation && recipe.portions != null && recipe.portions >= 1 && (
                  <p className="text-muted-foreground text-sm mt-0.5">
                    {recipe.portions} portions
                  </p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0 ml-2" />
            </div>
          </button>
        ))}
      </div>

      {/* Recipe detail dialog */}
      {selectedRecipeId && (
        <RecipeDetail
          recipeId={selectedRecipeId}
          open={!!selectedRecipeId}
          onOpenChange={(open) => {
            if (!open) setSelectedRecipeId(null);
          }}
        />
      )}
    </>
  );
}
