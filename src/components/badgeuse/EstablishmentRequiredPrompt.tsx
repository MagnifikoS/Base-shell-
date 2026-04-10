/**
 * Establishment selection prompt when no establishment is active.
 * Used by BadgeuseKioskView.
 */

import { Building2 } from "lucide-react";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { cn } from "@/lib/utils";

export function EstablishmentRequiredPrompt() {
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
          Vous n'êtes assigné à aucun établissement actif. Contactez votre administrateur.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] px-6">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Building2 className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">Sélectionnez un établissement</h2>
      <p className="text-sm text-muted-foreground mb-6 text-center">
        Choisissez l'établissement pour accéder à la badgeuse
      </p>
      <div className="w-full max-w-sm space-y-3">
        {establishments.map((establishment) => (
          <button
            key={establishment.id}
            onClick={() => setActiveEstablishment(establishment)}
            aria-label={`Sélectionner ${establishment.name}`}
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
                <p className="font-medium text-foreground truncate">{establishment.name}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
