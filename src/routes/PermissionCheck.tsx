import { useAuth } from "@/contexts/AuthContext";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { NoPermissionsPage } from "@/components/PermissionGuard";
import { hasLocalSession } from "@/lib/auth/hasLocalSession";

/**
 * Wrapper that checks if user has any permissions.
 * Shows NoPermissionsPage if user is connected but has no access.
 *
 * HOTFIX 1: When activeEstablishment is null, pass through to let
 * SmartHomeRedirect/AdminEstablishmentGate handle the flow.
 *
 * HOTFIX 2: Only show NoPermissionsPage when permissions are definitively
 * resolved (data !== undefined).
 *
 * FIX-3: When no local session token exists, skip the spinner entirely
 * and pass through to children. SmartHomeRedirect will handle the redirect
 * to /auth. This eliminates the dead-code issue where hasLocalSession()
 * in SmartHomeRedirect could never fire.
 *
 * SCOPE: Only applies when authLoading=true AND no local token.
 * When a token exists, the normal spinner + validation flow is preserved.
 */
export function PermissionCheck({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { activeEstablishment, loading: estLoading } = useEstablishment();
  const { hasAnyAccess, isLoading: permLoading, isAdmin, data: permissionsData } = usePermissions();

  // ══════════════════════════════════════════════════════════════════════════
  // FIX-3: No local token → skip spinner, let children redirect to /auth
  // SAFE: hasLocalSession() is synchronous, read-only localStorage check.
  // This ONLY fires when authLoading=true AND no token exists.
  // When a token exists (even expired), we wait for auth validation as before.
  // ══════════════════════════════════════════════════════════════════════════
  if (authLoading && !hasLocalSession()) {
    return <>{children}</>;
  }

  // Still loading auth or establishments (token exists → wait for validation)
  if (authLoading || estLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return <>{children}</>;
  }

  // HOTFIX 1: No establishment selected → pass through
  if (!activeEstablishment) {
    return <>{children}</>;
  }

  // Still loading permissions
  if (permLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // HOTFIX 2: Permissions not yet resolved
  if (permissionsData === undefined) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[PermissionCheck] permLoading=false but data undefined → waiting");
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Admin always has access
  if (isAdmin) {
    return <>{children}</>;
  }

  // No permissions at all
  if (!hasAnyAccess()) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[PermissionCheck] No access → NoPermissionsPage");
    }
    return <NoPermissionsPage />;
  }

  return <>{children}</>;
}
