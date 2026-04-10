/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PlatformLayout — Layout dédié pour /platform/*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * IMPORTANT:
 *   - Totalement indépendant de AppLayout / AppSidebar
 *   - Utilise le thème .platform-theme (violet)
 *   - Ne dépend PAS d'un établissement actif
 *   - Sidebar propre avec navigation plateforme
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  Building2,
  Blocks,
  ScrollText,
  Settings,
  Shield,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PLATFORM_NAV = [
  { label: "Dashboard", path: "/platform", icon: LayoutDashboard, end: true },
  { label: "Organisations", path: "/platform/organisations", icon: Building2, end: false },
  { label: "Modules globaux", path: "/platform/modules", icon: Blocks, end: false },
  { label: "Logs globaux", path: "/platform/logs", icon: ScrollText, end: false },
  { label: "Paramètres", path: "/platform/settings", icon: Settings, end: false },
] as const;

interface PlatformLayoutProps {
  children: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}

export function PlatformLayout({ children, breadcrumbs }: PlatformLayoutProps) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="platform-theme flex min-h-screen w-full">
      {/* ═══ Sidebar ═══ */}
      <aside
        className={cn(
          "flex flex-col border-r transition-all duration-200 shrink-0",
          collapsed ? "w-16" : "w-60",
        )}
        style={{
          backgroundColor: "hsl(var(--platform-sidebar-bg))",
          borderColor: "hsl(var(--platform-sidebar-border))",
          color: "hsl(var(--platform-sidebar-fg))",
        }}
      >
        {/* Logo / Identity */}
        <div className="flex items-center gap-3 px-4 h-14 border-b" style={{ borderColor: "hsl(var(--platform-sidebar-border))" }}>
          <Shield className="w-6 h-6 shrink-0" style={{ color: "hsl(var(--platform-primary))" }} />
          {!collapsed && (
            <span className="font-semibold text-sm truncate">Super Admin</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8 hover:bg-white/10"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-1">
          {PLATFORM_NAV.map((item) => {
            const isActive = item.end
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path);

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "font-medium"
                    : "opacity-70 hover:opacity-100",
                )}
                style={isActive ? {
                  backgroundColor: "hsl(var(--platform-sidebar-accent))",
                  color: "hsl(var(--platform-primary))",
                } : undefined}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t px-3 py-3 space-y-2" style={{ borderColor: "hsl(var(--platform-sidebar-border))" }}>
          {!collapsed && (
            <p className="text-xs truncate opacity-60">{user?.email}</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs hover:bg-white/10"
            onClick={() => {
              window.location.href = "/dashboard";
            }}
          >
            <LogOut className="w-3.5 h-3.5" />
            {!collapsed && "Quitter mode plateforme"}
          </Button>
        </div>
      </aside>

      {/* ═══ Main content ═══ */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Header with breadcrumb */}
        <header className="h-14 border-b flex items-center px-6 gap-4 shrink-0">
          {/* Badge */}
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{
              backgroundColor: "hsl(var(--platform-accent))",
              color: "hsl(var(--platform-accent-foreground))",
            }}
          >
            <Shield className="w-3 h-3" />
            Super Admin
          </span>

          {/* Breadcrumb */}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav className="flex items-center gap-1 text-sm text-muted-foreground">
              <NavLink to="/platform" className="hover:text-foreground transition-colors">
                Plateforme
              </NavLink>
              {breadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" />
                  {crumb.href ? (
                    <NavLink to={crumb.href} className="hover:text-foreground transition-colors">
                      {crumb.label}
                    </NavLink>
                  ) : (
                    <span className="text-foreground font-medium">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
