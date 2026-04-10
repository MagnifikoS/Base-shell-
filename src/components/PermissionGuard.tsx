import { usePermissions, type ModuleKey } from "@/hooks/usePermissions";
import { useEstablishmentModules } from "@/hooks/useEstablishmentModules";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ShieldX, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface PermissionGuardProps {
  moduleKey: ModuleKey;
  children: React.ReactNode;
}

/**
 * Route guard that checks module permission AND module activation.
 * Must be used INSIDE ProtectedRoute (auth already checked).
 *
 * PRIORITY ORDER:
 * 1. Module activation check (disabledModules) — takes absolute priority
 * 2. Admin bypass
 * 3. RBAC permission check
 */
export function PermissionGuard({ moduleKey, children }: PermissionGuardProps) {
  const { isAdmin, can, isLoading, isFetching, data } = usePermissions();
  const { activeEstablishment } = useEstablishment();
  const { disabledModules, isLoading: modulesLoading } = useEstablishmentModules(
    activeEstablishment?.id
  );

  // Show loading ONLY on initial fetch (no data yet) - not during refetch with cached data
  if (!data && (isLoading || isFetching || modulesLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // ═══ MODULE ACTIVATION CHECK — Priority over RBAC ═══
  // If module is explicitly disabled for this establishment, block access
  if (disabledModules && disabledModules.has(moduleKey)) {
    return <AccessDeniedPage />;
  }

  // Admin bypasses RBAC checks
  if (isAdmin) {
    return <>{children}</>;
  }

  // Check if user has access to this module
  if (can(moduleKey)) {
    return <>{children}</>;
  }

  // Access denied
  return <AccessDeniedPage />;
}

interface AdminGuardProps {
  children: React.ReactNode;
}

/**
 * Route guard for admin-only routes.
 * Must be used INSIDE ProtectedRoute (auth already checked).
 */
export function AdminGuard({ children }: AdminGuardProps) {
  const { isAdmin, isLoading, isFetching, data } = usePermissions();

  if (!data && (isLoading || isFetching)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return <AccessDeniedPage />;
  }

  return <>{children}</>;
}

/**
 * Page shown when user has no access to any module.
 */
export function NoPermissionsPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut();
      navigate("/auth", { replace: true });
    } catch {
      toast.error("Impossible de se déconnecter");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <ShieldX className="w-8 h-8 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Aucune permission</h1>
        <p className="text-muted-foreground">
          Votre compte n'a accès à aucun module. Contactez votre administrateur pour obtenir les
          permissions nécessaires.
        </p>
        <Button onClick={handleLogout} variant="outline" className="gap-2">
          <LogOut className="w-4 h-4" />
          Se déconnecter
        </Button>
      </div>
    </div>
  );
}

/**
 * Access denied page for specific module.
 */
function AccessDeniedPage() {
  const navigate = useNavigate();
  const { can: _can } = usePermissions();

  const handleBack = () => {
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldX className="w-8 h-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Accès refusé</h1>
        <p className="text-muted-foreground">
          Vous n'avez pas les permissions nécessaires pour accéder à cette page.
        </p>
        <Button onClick={handleBack} variant="outline">
          Retour
        </Button>
      </div>
    </div>
  );
}
