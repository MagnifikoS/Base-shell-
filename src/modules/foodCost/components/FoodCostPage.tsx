/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE FOOD COST — Main Page (Table view, READ-ONLY)
 * ═══════════════════════════════════════════════════════════════
 */

import { useState, useMemo } from "react";
import { PieChart, BookOpen } from "lucide-react";
import { useRecipeTypes } from "@/modules/recettes";
import { useFoodCostData } from "../hooks/useFoodCostData";
import { RecipeSearchBar } from "./RecipeSearchBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FoodCostTable } from "./FoodCostTable";
import { FoodCostMobileList } from "./FoodCostMobileList";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useIsMobile } from "@/hooks/useIsMobile";

export function FoodCostPageContent() {
  const isMobile = useIsMobile();
  const { recipeTypes, isLoading: typesLoading } = useRecipeTypes();
  const { recipes, costResults, isLoading: dataLoading } = useFoodCostData();

  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const isLoading = typesLoading || dataLoading;

  const typeMap = useMemo(
    () => new Map(recipeTypes.map((t) => [t.id, t.name])),
    [recipeTypes]
  );

  const filtered = useMemo(() => {
    let list = recipes;
    if (selectedType) {
      list = list.filter((r) => r.recipe_type_id === selectedType);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q));
    }
    return list;
  }, [recipes, selectedType, search]);

  return (
    <ResponsiveLayout>
      <div className="container max-w-4xl py-6 px-4 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <PieChart className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Food Cost</h1>
            <p className="text-xs text-muted-foreground">Coût de revient actuel</p>
          </div>
        </div>

        {/* Search */}
        <RecipeSearchBar value={search} onChange={setSearch} />

        {/* Type filter dropdown */}
        {recipeTypes.length > 0 && (
          <Select
            value={selectedType ?? "all"}
            onValueChange={(v) => setSelectedType(v === "all" ? null : v)}
          >
            <SelectTrigger className="w-full h-10 rounded-xl bg-card border-border/60">
              <SelectValue placeholder="Filtrer par type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {recipeTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-muted/60 flex items-center justify-center mb-4">
              <BookOpen className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">
              {search.trim() || selectedType
                ? "Aucune recette trouvée"
                : "Aucune recette pour l'instant"}
            </p>
          </div>
        )}

        {/* Table / Mobile list */}
        {!isLoading && filtered.length > 0 && (
          isMobile ? (
            <FoodCostMobileList
              recipes={filtered}
              costResults={costResults}
              typeMap={typeMap}
            />
          ) : (
            <FoodCostTable
              recipes={filtered}
              costResults={costResults}
              typeMap={typeMap}
            />
          )
        )}
      </div>
    </ResponsiveLayout>
  );
}
