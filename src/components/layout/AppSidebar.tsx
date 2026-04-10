/**
 * ═══════════════════════════════════════════════════════════════════════════
 * APP SIDEBAR — Desktop Navigation Sidebar
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Consumes NAV_REGISTRY via buildNavFromPermissions for SSOT navigation.
 * No hardcoded menuItems arrays — all items come from navRegistry.ts.
 *
 * V2.1: Supports sectioned layout via SIDEBAR_V21_ENABLED flag.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ShieldCheck, FileSignature, Check, ChevronDown } from "lucide-react";
import { useAlerts } from "@/hooks/alerts/useAlerts";

import { SIGNATURE_STUDIO_ENABLED, SIDEBAR_V21_ENABLED } from "@/config/featureFlags";

import { toast } from "sonner";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import { usePermissions } from "@/hooks/usePermissions";
import { useEstablishmentModules } from "@/hooks/useEstablishmentModules";
import { getSidebarItemsGrouped } from "@/lib/nav/buildNavFromPermissions";
import { SidebarSectioned } from "./SidebarSectioned";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserSessionTag } from "./UserSessionTag";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { prefetchRoute } from "@/lib/prefetch/routePrefetch";

export function AppSidebar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { isAdmin } = permissions;

  // Unified establishment access hook - single source of truth
  const {
    accessibleEstablishments,
    showSelector,
    activeEstablishment,
    activeEstablishmentId,
    setActiveEstablishment,
    loading,
  } = useEstablishmentAccess();

  // Alerts hook - uses active establishment
  const { alerts: _alerts } = useAlerts(activeEstablishmentId);

  // Module activation filter (SaaS) — null = all enabled (AMIR mode)
  const { disabledModules } = useEstablishmentModules(activeEstablishmentId);

  // Build sidebar items from SSOT registry + permissions (legacy mode only)
  const groupedItems = useMemo(() => {
    return getSidebarItemsGrouped(permissions, disabledModules);
  }, [permissions, disabledModules]);

  // Robust logout handler with explicit redirect
  const handleLogout = useCallback(async () => {
    try {
      await signOut();
      // Explicit navigation for Preview compatibility
      navigate("/auth", { replace: true });
    } catch (_error) {
      toast.error("Impossible de se déconnecter");
    }
  }, [signOut, navigate]);

  return (
    <Sidebar className="border-r border-sidebar-border" aria-label="Menu principal">
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <Building2 className="w-5 h-5 text-sidebar-primary-foreground" />
          </div>
          <span className="font-semibold text-sidebar-foreground">GestionPro</span>
        </div>
      </SidebarHeader>

      <SidebarContent aria-label="Navigation du menu">
        {/* Unified Establishment Selector - visible if user has >1 accessible establishment */}
        {showSelector && (
          <div className="px-3 py-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "flex items-center justify-between gap-2 w-full px-3 py-2 rounded-md",
                    "bg-sidebar-accent border border-sidebar-border text-sidebar-foreground text-sm",
                    "hover:bg-sidebar-accent/80 transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                  )}
                  disabled={loading}
                  aria-label="Sélectionner un établissement"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">
                      {loading ? "Chargement..." : activeEstablishment?.name || "Sélectionner"}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {accessibleEstablishments.map((est) => (
                  <DropdownMenuItem
                    key={est.id}
                    onClick={() => setActiveEstablishment(est)}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="truncate">{est.name}</span>
                    </div>
                    {est.id === activeEstablishmentId && (
                      <Check className="h-4 w-4 text-primary flex-shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* V2.1: Sectioned layout OR Legacy flat layout */}
        {SIDEBAR_V21_ENABLED ? (
          <SidebarSectioned permissions={permissions} disabledModules={disabledModules} establishmentType={activeEstablishment?.establishment_type ?? null} />
        ) : (
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {/* Main menu items from SSOT registry */}
                  {groupedItems.main.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton asChild onMouseEnter={() => prefetchRoute(item.route)}>
                        <NavLink
                          to={item.route}
                          className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                          activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                        >
                          <item.icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}

                  {/* RBAC-based items from SSOT registry */}
                  {groupedItems.rbac.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton asChild onMouseEnter={() => prefetchRoute(item.route)}>
                        <NavLink
                          to={item.route}
                          className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                          activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                        >
                          <item.icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarSeparator />

            {/* Settings items from SSOT registry */}
            {groupedItems.settings.length > 0 && (
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {groupedItems.settings.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton asChild onMouseEnter={() => prefetchRoute(item.route)}>
                          <NavLink
                            to={item.route}
                            className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                            activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                          >
                            <item.icon className="w-5 h-5" />
                            <span>{item.label}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </>
        )}
      </SidebarContent>

      {/* Footer: Only shown in legacy mode (V2.1 handles admin in sections) */}
      {!SIDEBAR_V21_ENABLED && (
        <SidebarFooter className="border-t border-sidebar-border flex flex-col items-start">
          {/* Administrateur - Visible only if isAdmin (via SSOT check) */}
          {isAdmin && (
            <NavLink
              to="/admin"
              onMouseEnter={() => prefetchRoute("/admin")}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors w-full"
              activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
            >
              <ShieldCheck className="w-5 h-5" />
              <span>Administrateur</span>
            </NavLink>
          )}

          {/* Studio Signature - Prototype (Admin only, feature flag) */}
          {isAdmin && SIGNATURE_STUDIO_ENABLED && (
            <NavLink
              to="/studio-signature"
              onMouseEnter={() => prefetchRoute("/studio-signature")}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors w-full"
              activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
            >
              <FileSignature className="w-5 h-5" />
              <span>Studio Signature</span>
            </NavLink>
          )}

          {/* User initials button + theme toggle */}
          <div className="flex items-center justify-between px-2">
            <UserSessionTag user={user} onClick={handleLogout} />
            <ThemeToggle />
          </div>
        </SidebarFooter>
      )}

      {/* V2.1: Simplified footer with user session + theme toggle */}
      {SIDEBAR_V21_ENABLED && (
        <SidebarFooter className="border-t border-sidebar-border">
          <div className="flex items-center justify-between px-2">
            <UserSessionTag user={user} onClick={handleLogout} />
            <ThemeToggle />
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
