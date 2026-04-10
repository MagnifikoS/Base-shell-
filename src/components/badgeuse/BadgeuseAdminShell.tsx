/**
 * BadgeuseAdminShell - Unified admin view for badgeuse:write users
 * 
 * SINGLE SOURCE: This component is used for BOTH mobile and desktop.
 * Contains all tabs: Présence, Paramètres, Historique, Pré-remplissage
 * 
 * Permission: Requires badgeuse:write (enforced by parent)
 */

import { useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Settings, History, CalendarPlus, Building2 } from "lucide-react";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { cn } from "@/lib/utils";

import { DesktopPresencePage } from "@/components/presence/DesktopPresencePage";
import { BadgeuseSettingsTab } from "@/components/badgeuse/BadgeuseSettingsTab";
import { BadgeuseHistoryTab } from "@/components/badgeuse/BadgeuseHistoryTab";
import { BadgeuseBackfillTab } from "@/components/badgeuse/BadgeuseBackfillTab";

/**
 * Establishment selection prompt when no establishment is active
 */
function EstablishmentRequiredPrompt() {
  const { establishments, setActiveEstablishment, loading } = useEstablishment();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (establishments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Building2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Aucun établissement disponible
        </h2>
        <p className="text-sm text-muted-foreground">
          Vous n'êtes assigné à aucun établissement actif.
          Contactez votre administrateur.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] px-6">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Building2 className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">
        Sélectionnez un établissement
      </h2>
      <p className="text-sm text-muted-foreground mb-6 text-center">
        Choisissez l'établissement pour accéder à la badgeuse
      </p>
      <div className="w-full max-w-sm space-y-3">
        {establishments.map((establishment) => (
          <button
            key={establishment.id}
            onClick={() => setActiveEstablishment(establishment)}
            className={cn(
              "w-full p-4 rounded-xl border-2 text-left transition-all",
              "bg-card hover:bg-accent/50 active:scale-[0.98]",
              "border-border hover:border-primary/50",
              "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">
                  {establishment.name}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function BadgeuseAdminShell() {
  const { activeEstablishment } = useEstablishment();

  // SSOT: Establishment from Context only (no admin/non-admin branching)
  const effectiveEstablishmentId = activeEstablishment?.id ?? null;

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // No establishment selected: show selection prompt
  if (effectiveEstablishmentId === null) {
    return (
      <div className="space-y-6 p-4 md:p-0">
        <h1 className="text-2xl font-semibold text-foreground">Badgeuse</h1>
        <EstablishmentRequiredPrompt />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-0">
      <h1 className="text-2xl font-semibold text-foreground">Badgeuse</h1>

      <Tabs defaultValue="presence" className="w-full">
        {/* Responsive TabsList - horizontal scroll on mobile */}
        <TabsList className="inline-flex h-10 items-center justify-start rounded-md bg-muted p-1 text-muted-foreground overflow-x-auto max-w-full">
          <TabsTrigger value="presence" className="flex items-center gap-2 whitespace-nowrap">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Présence</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2 whitespace-nowrap">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Paramètres</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2 whitespace-nowrap">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">Historique</span>
          </TabsTrigger>
          <TabsTrigger value="backfill" className="flex items-center gap-2 whitespace-nowrap">
            <CalendarPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Pré-remplissage</span>
          </TabsTrigger>
        </TabsList>

        {/* Présence Tab */}
        <TabsContent value="presence" className="mt-6">
          <DesktopPresencePage establishmentId={effectiveEstablishmentId} />
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="mt-6">
          <BadgeuseSettingsTab establishmentId={effectiveEstablishmentId} />
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="mt-6">
          <BadgeuseHistoryTab establishmentId={effectiveEstablishmentId} />
        </TabsContent>

        {/* Backfill Tab */}
        <TabsContent value="backfill" className="mt-6">
          <BadgeuseBackfillTab establishmentId={effectiveEstablishmentId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
