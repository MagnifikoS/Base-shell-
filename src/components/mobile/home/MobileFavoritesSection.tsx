/**
 * Center zone: displays user's favorite nav items as large tiles.
 * Isolated — removing this file has zero impact on the app.
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { NAV_REGISTRY, type NavItem } from "@/config/navRegistry";
import { Star, Bookmark, Heart, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileFavoritesSectionProps {
  favoriteIds: string[];
  /** All RBAC-allowed item IDs (for filtering) */
  allowedIds: Set<string>;
}

export function MobileFavoritesSection({
  favoriteIds,
  allowedIds,
}: MobileFavoritesSectionProps) {
  const navigate = useNavigate();

  const favorites = useMemo(() => {
    const items: NavItem[] = [];
    for (const id of favoriteIds) {
      if (!allowedIds.has(id)) continue;
      const item = NAV_REGISTRY.find((n) => n.id === id && !n.hidden);
      if (item) items.push(item);
    }
    return items;
  }, [favoriteIds, allowedIds]);

  return (
    <div className="flex flex-col flex-1">
      {/* Favorites grid */}
      {favorites.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {favorites.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.route)}
                className={cn(
                  "flex flex-col items-center justify-center gap-4 p-6 rounded-2xl",
                  "bg-card border border-border/50 shadow-sm",
                  "transition-all duration-200 touch-manipulation",
                  "min-h-[130px] w-full",
                  "active:scale-[0.97] hover:shadow-md"
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-center w-14 h-14 rounded-2xl",
                    item.tileColor || "bg-primary/10 text-primary"
                  )}
                >
                  <Icon className="h-7 w-7" />
                </div>
                <span className="text-sm font-semibold text-center leading-tight text-foreground">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Illustration + CTA — always visible */}
      <div className="flex flex-col items-center justify-center flex-1 text-center px-6 py-8">
        <FavoritesIllustration />
        <p className="text-base font-semibold text-foreground mb-1">
          Ajoutez ou retirez vos modules
        </p>
        <p className="text-sm text-muted-foreground">
          favoris depuis Paramètres
        </p>
      </div>
    </div>
  );
}

/** Inline SVG illustration — no external image, no white background */
function FavoritesIllustration() {
  return (
    <div className="relative w-40 h-40 mb-5 flex items-center justify-center">
      {/* Decorative sparkles */}
      <Sparkles className="absolute -top-1 -right-1 h-5 w-5 text-amber-300/60" />
      <Sparkles className="absolute -bottom-1 -left-2 h-4 w-4 text-primary/30 rotate-45" />

      {/* Main circle */}
      <div className="relative w-28 h-28 rounded-3xl bg-gradient-to-br from-primary/5 to-primary/15 flex items-center justify-center border border-primary/10">
        {/* Star badge */}
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center shadow-md shadow-amber-200/50">
          <Star className="h-5 w-5 text-white fill-white" />
        </div>

        {/* Checklist lines */}
        <div className="flex flex-col gap-2.5 mt-3 w-16">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5L4.5 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500" />
                </svg>
              </div>
              <div className={cn(
                "h-1.5 rounded-full bg-muted",
                i === 0 ? "w-full" : i === 1 ? "w-3/4" : "w-5/6"
              )} />
            </div>
          ))}
        </div>

        {/* Side decorations */}
        <Bookmark className="absolute -left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-primary/20 -rotate-12" />
        <Heart className="absolute -right-4 bottom-4 h-4 w-4 text-rose-300/40 rotate-12" />
      </div>
    </div>
  );
}
