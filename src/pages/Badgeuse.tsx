/**
 * Badgeuse page - UNIFIED READ/WRITE ACCESS
 * 
 * PERMISSION MODEL (SINGLE SOURCE):
 * - badgeuse:write → BadgeuseAdminShell (full tabs: Présence, Paramètres, Historique, Backfill)
 * - badgeuse:read  → BadgeuseKioskView (current day only, read-only, no settings)
 * 
 * NO fork between mobile/desktop: same components for both.
 * NO dependency on presence:* permission.
 */

import { usePermissions } from "@/hooks/usePermissions";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileLayout } from "@/components/mobile/MobileLayout";
import { AppLayout } from "@/components/layout/AppLayout";
import { BadgeuseAdminShell } from "@/components/badgeuse/BadgeuseAdminShell";
import { BadgeuseKioskView } from "@/components/badgeuse/BadgeuseKioskView";
import { ShieldX } from "lucide-react";

/**
 * Access denied component for users without badgeuse permission
 */
function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <ShieldX className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">
        Accès refusé
      </h2>
      <p className="text-sm text-muted-foreground">
        Vous n'avez pas les permissions nécessaires pour accéder à la badgeuse.
      </p>
    </div>
  );
}

/**
 * Main content switcher based on permission level
 */
function BadgeuseContent() {
  const { can, isLoading } = usePermissions();

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Check permissions: badgeuse:write → Admin, badgeuse:read → Kiosk, else → Denied
  const hasWrite = can("badgeuse", "write");
  const hasRead = can("badgeuse", "read");

  if (hasWrite) {
    return <BadgeuseAdminShell />;
  }

  if (hasRead) {
    return <BadgeuseKioskView />;
  }

  return <AccessDenied />;
}

/**
 * Badgeuse page with responsive layout wrapper
 * 
 * CRITICAL: No mobile/desktop fork for content.
 * Both use the same BadgeuseAdminShell or BadgeuseKioskView.
 * Only the layout wrapper differs (MobileLayout vs AppLayout).
 */
export default function Badgeuse() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <MobileLayout>
        <BadgeuseContent />
      </MobileLayout>
    );
  }

  return (
    <AppLayout>
      <BadgeuseContent />
    </AppLayout>
  );
}
