/**
 * ═══════════════════════════════════════════════════════════════
 * SHARED — Recipe Type Filter chips (used by Recettes + Food Cost)
 * ═══════════════════════════════════════════════════════════════
 */

import { cn } from "@/lib/utils";

interface RecipeTypeOption {
  id: string;
  name: string;
}

interface RecipeTypeFilterProps {
  types: RecipeTypeOption[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export function RecipeTypeFilter({ types, selected, onSelect }: RecipeTypeFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1">
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all",
          selected === null
            ? "bg-primary text-primary-foreground shadow-sm"
            : "bg-card border border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
        )}
      >
        Tous
      </button>
      {types.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id === selected ? null : t.id)}
          className={cn(
            "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all",
            selected === t.id
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-card border border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
          )}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}
