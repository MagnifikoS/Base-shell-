/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOBILE BOTTOM NAV — Bottom Navigation Bar
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Consumes NAV_REGISTRY via buildNavFromPermissions for SSOT navigation.
 * No hardcoded BASE_NAV_ITEMS array — all items come from navRegistry.ts.
 *
 * MOBILE NAV PREFS:
 * - Applies user's hiddenIds from localStorage
 * - VISIBLE = RBAC_ALLOWED ∩ USER_PREFS
 * - Without prefs → shows all RBAC-allowed items (fallback)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useEstablishmentModules } from "@/hooks/useEstablishmentModules";
import { buildNavFromPermissions } from "@/lib/nav/buildNavFromPermissions";
import { useEstablishmentRoleNavConfig } from "@/hooks/useEstablishmentRoleNavConfig";
import { useUnreadAlertsCount } from "@/hooks/useUnreadAlertsCount";

export function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user: _user } = useAuth();
  const { activeEstablishment } = useEstablishment();
  const permissions = usePermissions();
  const alertsCount = useUnreadAlertsCount();

  const establishmentId = activeEstablishment?.id ?? null;

  // Load prefs from DB (per-role, UNION merge)
  const { prefs } = useEstablishmentRoleNavConfig(establishmentId);

  // Module activation filter (SaaS)
  const { disabledModules, isLoading: modulesLoading } = useEstablishmentModules(establishmentId);

  // Build nav items from SSOT registry + permissions + prefs + module activation
  const navItems = useMemo(() => {
    // Wait for modules to load to prevent flash of all modules
    if (modulesLoading) return [];
    const { mobileBottomNav } = buildNavFromPermissions(permissions, prefs, disabledModules);
    return mobileBottomNav;
  }, [permissions, prefs, disabledModules, modulesLoading]);

  return (
    <nav
      aria-label="Navigation principale"
      className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border safe-area-bottom"
    >
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const isActive =
            location.pathname === item.route ||
            (item.route === "/" && location.pathname === "/home");
          const Icon = item.icon;
          const isNotifItem = item.id === "notifications_nav" || item.route === "/notifications";
          const badgeCount = isNotifItem ? alertsCount : 0;

          return (
            <button
              key={item.id}
              onClick={() => navigate(item.route)}
              aria-current={isActive ? "page" : undefined}
              aria-label={item.label}
              className={cn(
                "flex flex-col items-center justify-center flex-1 h-full py-2 px-3 rounded-lg transition-colors relative",
                "active:bg-muted/50 touch-manipulation",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="relative">
                <Icon className={cn("h-6 w-6", isActive && "stroke-[2.5]")} />
                {badgeCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1 leading-none">
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </div>
              <span className={cn("text-xs mt-1", isActive ? "font-medium" : "font-normal")}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
