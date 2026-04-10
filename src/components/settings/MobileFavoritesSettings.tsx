/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOBILE FAVORITES SETTINGS — Toggle favorite nav items
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Standalone component embedded in Paramètres page.
 * Isolated — removing this file has zero impact on the app.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useEstablishmentModules } from "@/hooks/useEstablishmentModules";
import { buildNavFromPermissions, type NavPermissions } from "@/lib/nav/buildNavFromPermissions";
import { useEstablishmentRoleNavConfig } from "@/hooks/useEstablishmentRoleNavConfig";
import { useMobileFavorites } from "@/hooks/useMobileFavorites";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** IDs to exclude from favorites list (settings/admin/home) */
const EXCLUDED_IDS = new Set([
  "parametres",
  "administration",
  "mobile_nav_config",
  "home",
  "notifications_nav",
  "dashboard",
]);

export function MobileFavoritesSettings() {
  const { user } = useAuth();
  const { activeEstablishment } = useEstablishment();
  const permissions = usePermissions();
  const userId = user?.id ?? null;
  const establishmentId = activeEstablishment?.id ?? null;

  const { prefs } = useEstablishmentRoleNavConfig(establishmentId);
  const { favoriteIds, toggleFavorite, isFavorite } = useMobileFavorites(userId);
  const { disabledModules } = useEstablishmentModules(establishmentId);

  const navPermissions: NavPermissions = useMemo(
    () => ({
      isAdmin: permissions.isAdmin,
      can: permissions.can,
      getScope: permissions.getScope,
      teamIds: permissions.teamIds,
      teamTabKeys: [],
    }),
    [permissions]
  );

  const availableItems = useMemo(() => {
    const { mobileHomeTiles } = buildNavFromPermissions(navPermissions, prefs, disabledModules);
    return mobileHomeTiles.filter((m) => !EXCLUDED_IDS.has(m.id));
  }, [navPermissions, prefs, disabledModules]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Sélectionnez les modules à afficher en favoris sur votre accueil mobile.
      </p>

      <div className="space-y-1">
        {availableItems.map((item) => {
          const Icon = item.icon;
          const active = isFavorite(item.id);
          return (
            <button
              key={item.id}
              onClick={() => toggleFavorite(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                "hover:bg-muted/50 active:bg-muted touch-manipulation text-left"
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-lg shrink-0",
                  item.tileColor || "bg-primary/10 text-primary"
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="flex-1 text-sm font-medium text-foreground">
                {item.label}
              </span>
              <Star
                className={cn(
                  "h-5 w-5 transition-colors shrink-0",
                  active
                    ? "fill-amber-400 text-amber-400"
                    : "text-muted-foreground/40"
                )}
              />
            </button>
          );
        })}
      </div>

      {favoriteIds.length > 0 && (
        <p className="text-xs text-muted-foreground text-center pt-2">
          {favoriteIds.length} favori{favoriteIds.length > 1 ? "s" : ""} sélectionné{favoriteIds.length > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
