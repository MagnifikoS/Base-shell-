/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — Toggle Component
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Simple card with a switch to enable/disable mutualisation for the
 * current establishment. Used inside InventaireSettingsPage.
 */

import { Switch } from "@/components/ui/switch";
import { useMutualisationEnabled } from "../hooks/useMutualisationEnabled";
import { Loader2, Layers } from "lucide-react";

export function MutualisationToggle() {
  const { enabled, isLoading, toggle, isPending } = useMutualisationEnabled();

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex items-start gap-4">
        <div className="rounded-md bg-primary/10 p-2">
          <Layers className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 space-y-1">
          <h3 className="text-base font-semibold text-foreground">
            Mutualisation d'affichage inventaire
          </h3>
          <p className="text-sm text-muted-foreground">
            Regroupe les produits similaires (ex : différentes marques de
            Lasagne) pour un affichage simplifié dans l'inventaire et les
            alertes stock. Ne modifie pas les produits réels ni le stock.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          {(isLoading || isPending) && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <Switch
            checked={enabled}
            onCheckedChange={(val) => toggle(val)}
            disabled={isLoading || isPending}
            aria-label="Activer la mutualisation d'affichage inventaire"
          />
        </div>
      </div>

      {enabled && (
        <div className="rounded-md bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <strong className="text-foreground">Activé</strong> — Les suggestions
          de regroupement seront disponibles dans l'inventaire. Chaque
          regroupement nécessite une validation manuelle.
        </div>
      )}
    </div>
  );
}
