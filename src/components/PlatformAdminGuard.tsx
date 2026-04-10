/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PlatformAdminGuard — P0 Super Admin Plateforme
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Route guard pour les routes /platform.
 *
 * IMPORTANT:
 *   - Ne dépend PAS de PermissionGuard
 *   - Ne dépend PAS de AdminGuard
 *   - Ne dépend PAS de usePermissions()
 *   - Ne dépend PAS d'un établissement actif
 *   - Vérifie uniquement: authentification + is_platform_admin()
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PlatformAdminGuardProps {
  children: React.ReactNode;
}

export function PlatformAdminGuard({ children }: PlatformAdminGuardProps) {
  const { user, loading: authLoading } = useAuth();
  const { isPlatformAdmin, isLoading: platformLoading } = usePlatformAdmin();

  // Auth loading
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Not authenticated → redirect to auth
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Platform admin check loading
  if (platformLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Not a platform admin → access denied with explanation
  if (!isPlatformAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
        <div className="text-center space-y-6 max-w-lg">
          <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <ShieldX className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Accès réservé — Super Admin Plateforme</h1>
          <div className="text-sm text-muted-foreground space-y-2 text-left bg-muted/50 rounded-lg p-4">
            <p>
              Cette section est réservée aux <strong>Super Admins Plateforme</strong> (gestion multi-établissements).
            </p>
            <p>
              Si vous êtes <strong>administrateur d'une organisation</strong>, votre espace se trouve sur le{" "}
              <a href="/global-dashboard" className="text-primary underline underline-offset-2">
                Dashboard Organisation
              </a>.
            </p>
            <p className="text-xs text-muted-foreground/70 pt-2">
              Les deux rôles sont indépendants : être admin d'une organisation ne donne pas accès à la plateforme, et inversement.
            </p>
          </div>
          <Button variant="outline" onClick={() => window.history.back()}>
            Retour
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
