import { Suspense, lazy, useMemo, useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useEstablishmentModules } from "@/hooks/useEstablishmentModules";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { NoPermissionsPage } from "@/components/PermissionGuard";
import { hasLocalSession } from "@/lib/auth/hasLocalSession";
import { SplashScreen } from "@/components/SplashScreen";
import { queryClient } from "@/lib/queryClient";
import { supabase } from "@/integrations/supabase/client";

// PERF: Lazy-load mobile-only components (API-PERF-013)
const MobileHome = lazy(() =>
  import("@/components/mobile/home/MobileHome").then((m) => ({
    default: m.MobileHome,
  }))
);
const AdminEstablishmentGate = lazy(() =>
  import("@/components/mobile/admin/AdminEstablishmentGate").then((m) => ({
    default: m.AdminEstablishmentGate,
  }))
);

// ══════════════════════════════════════════════════════════════════════════════
// OPT-3: Preload MobileHome chunk reference (does NOT execute or mount)
// Calling this function downloads the JS bundle in the background.
// ══════════════════════════════════════════════════════════════════════════════
let mobileHomePreloaded = false;
function preloadMobileHome(): void {
  if (mobileHomePreloaded) return;
  mobileHomePreloaded = true;
  import("@/components/mobile/home/MobileHome").catch(() => {
    // Non-critical: if preload fails, Suspense fallback handles it normally
    mobileHomePreloaded = false;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// OPT-4: Prefetch MobileHome data queries (roleNavConfig + profiles)
// Results go into React Query cache — MobileHome reads them instantly on mount.
// SAFE: No UI is shown — data waits in cache until RBAC gates pass.
// NOTE: teamTabKeys depends on permissions.teamIds (not available yet) — skipped.
// NOTE: favorites uses localStorage (synchronous) — no prefetch needed.
// ══════════════════════════════════════════════════════════════════════════════
function prefetchMobileHomeData(userId: string, establishmentId: string): void {
  // Prefetch role nav config (2 queries: user_roles + role_configs)
  queryClient.prefetchQuery({
    queryKey: ["user-roles-for-nav", userId, establishmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role_id")
        .eq("user_id", userId)
        .eq("establishment_id", establishmentId);
      if (error) return [];
      return (data ?? []).map((r) => r.role_id);
    },
    staleTime: 120_000,
  });

  queryClient.prefetchQuery({
    queryKey: ["establishment-role-nav-config", establishmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("establishment_role_nav_config")
        .select("role_id, hidden_ids")
        .eq("establishment_id", establishmentId);
      if (error) return [];
      return (data ?? []).map((row) => ({
        role_id: row.role_id,
        hidden_ids: row.hidden_ids ?? [],
      }));
    },
    staleTime: 60_000,
  });

  // Prefetch user profile (full_name for employee view)
  queryClient.prefetchQuery({
    queryKey: ["profile-fullname", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", userId)
        .single();
      return data?.full_name ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function MobileSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

/** Module cascade for desktop redirect: [moduleKey, route] */
const MODULE_CASCADE: [string, string][] = [
  ["dashboard", "/dashboard"],
  ["planning", "/planning"],
  ["presence", "/presence"],
  ["salaries", "/salaries"],
  ["badgeuse", "/badgeuse"],
  ["paie", "/paie"],
  ["conges_absences", "/conges-absences"],
  ["factures", "/factures"],
  ["fournisseurs", "/fournisseurs"],
  ["produits_v2", "/produits-v2"],
  
  ["inventaire", "/inventaire"],
  ["caisse", "/caisse"],
  ["rapports", "/rapports"],
  ["gestion_personnel", "/gestion-personnel"],
  ["alertes", "/notifications"],
  ["parametres", "/parametres"],
];

/**
 * Smart redirect from "/" based on user permissions and device.
 * Mobile users see MobileHome, desktop users are redirected to their first module.
 *
 * HOTFIX: Multi-establishment admin on mobile must select establishment BEFORE
 * permissions can load. Early-return to gate prevents infinite spinner.
 */
export function SmartHomeRedirect() {
  const { user, loading: authLoading } = useAuth();
  const { activeEstablishment, loading: estLoading } = useEstablishment();
  const { can, isLoading: permLoading, isAdmin, hasAnyAccess: _hasAnyAccess } = usePermissions();
  const isMobile = useIsMobile();
  const { isPlatformAdmin, isLoading: platformAdminLoading } = usePlatformAdmin();
  const { disabledModules, isLoading: modulesLoading } = useEstablishmentModules(
    activeEstablishment?.id
  );

  // ══════════════════════════════════════════════════════════════════════════
  // OPT-3: Preload MobileHome JS chunk as soon as we know it's mobile + user
  // SAFE: Only downloads JS, does NOT mount component or trigger hooks.
  // ══════════════════════════════════════════════════════════════════════════
  const preloadTriggeredRef = useRef(false);
  useEffect(() => {
    if (isMobile && user && !preloadTriggeredRef.current) {
      preloadTriggeredRef.current = true;
      preloadMobileHome();
    }
  }, [isMobile, user]);

  // ══════════════════════════════════════════════════════════════════════════
  // OPT-4: Prefetch MobileHome data queries as soon as userId + estId known
  // SAFE: Data goes into React Query cache only. No UI shown until RBAC passes.
  // ══════════════════════════════════════════════════════════════════════════
  const prefetchTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    const userId = user?.id;
    const estId = activeEstablishment?.id;
    if (!isMobile || !userId || !estId) return;
    const key = `${userId}_${estId}`;
    if (prefetchTriggeredRef.current === key) return;
    prefetchTriggeredRef.current = key;
    prefetchMobileHomeData(userId, estId);
  }, [isMobile, user?.id, activeEstablishment?.id]);

  /**
   * Check if a module is both RBAC-allowed AND activation-allowed.
   * This prevents redirecting to a module that PermissionGuard will block.
   */
  const canAccess = useMemo(() => {
    return (moduleKey: string) => {
      // RBAC check
      if (!can(moduleKey as Parameters<typeof can>[0])) return false;
      // Module activation check
      if (disabledModules && disabledModules.has(moduleKey)) return false;
      return true;
    };
  }, [can, disabledModules]);

  // ── C1: Court-circuit pour non-authenticated users ───────────────────
  if (authLoading && !hasLocalSession()) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[SmartHomeRedirect] No local token → fast redirect to /auth");
    }
    return <Navigate to="/auth" replace />;
  }

  // Auth still loading (but local token exists → wait for validation)
  if (authLoading) {
    return <SplashScreen />;
  }

  // Not authenticated
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OPT-1: MERGED GATE — Wait for BOTH establishment + platformAdmin together
  // Before: sequential gates (platformAdmin → then establishment)
  // After:  single gate waits for both in parallel → saves one round-trip
  // SAFE: Both queries depend only on `user` (JWT), no mutual dependency.
  // ══════════════════════════════════════════════════════════════════════════
  if (platformAdminLoading || estLoading) {
    return <SplashScreen />;
  }

  // Platform admin → redirect to /platform (checked after BOTH are resolved)
  if (isPlatformAdmin) {
    return <Navigate to="/platform" replace />;
  }

  // No establishment selected yet
  if (!activeEstablishment) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[SmartHomeRedirect] No active establishment → show gate");
    }
    if (isMobile) {
      return (
        <Suspense fallback={<MobileSpinner />}>
          <AdminEstablishmentGate>
            <MobileHome />
          </AdminEstablishmentGate>
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<MobileSpinner />}>
        <AdminEstablishmentGate>
          <Navigate to="/dashboard" replace />
        </AdminEstablishmentGate>
      </Suspense>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OPT-2: permissions + modules already fire in parallel via React Query
  // (both have `enabled: !!establishmentId`). Single merged gate here.
  // ══════════════════════════════════════════════════════════════════════════
  if (permLoading || modulesLoading) {
    return <SplashScreen />;
  }

  // Mobile: show MobileHome (it handles its own module filtering)
  if (isMobile && isAdmin) {
    return (
      <Suspense fallback={<MobileSpinner />}>
        <AdminEstablishmentGate>
          <MobileHome />
        </AdminEstablishmentGate>
      </Suspense>
    );
  }

  if (isMobile) {
    return (
      <Suspense fallback={<MobileSpinner />}>
        <MobileHome />
      </Suspense>
    );
  }

  // Desktop: redirect to first accessible module
  for (const [moduleKey, route] of MODULE_CASCADE) {
    if (canAccess(moduleKey)) {
      return <Navigate to={route} replace />;
    }
  }

  return <NoPermissionsPage />;
}
