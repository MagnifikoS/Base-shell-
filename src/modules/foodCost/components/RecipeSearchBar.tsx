/**
 * ═══════════════════════════════════════════════════════════════
 * SHARED — Recipe Search Bar (used by Recettes + Food Cost)
 * ═══════════════════════════════════════════════════════════════
 */

import { Search, X } from "lucide-react";

interface RecipeSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function RecipeSearchBar({ value, onChange }: RecipeSearchBarProps) {
  return (
    <div className="relative">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
      <input
        type="text"
        placeholder="Rechercher une recette…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-border/60 bg-card px-10 py-2.5 text-sm text-foreground
                   placeholder:text-muted-foreground/50
                   shadow-[0_1px_3px_0_hsl(var(--foreground)/0.04)]
                   focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40
                   transition-all"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
