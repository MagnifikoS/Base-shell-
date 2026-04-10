/**
 * Presence page - Desktop standalone view
 * Wraps DesktopPresencePage with ResponsiveLayout for sidebar + bottom nav
 * Uses SSOT EstablishmentContext via useEstablishmentAccess
 */

import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { DesktopPresencePage } from "@/components/presence/DesktopPresencePage";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";

export default function Presence() {
  const { activeEstablishmentId } = useEstablishmentAccess();

  return (
    <ResponsiveLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Présence</h1>
        <DesktopPresencePage establishmentId={activeEstablishmentId} />
      </div>
    </ResponsiveLayout>
  );
}
