/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — Group Manager Panel
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Displays existing groups + suggestions + manual creation.
 * Passes B2B data through creation flow.
 * All writes go to inventory_mutualisation_* only.
 */

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, Sparkles, Layers, Package, EyeOff, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSuggestGroups } from "../hooks/useSuggestGroups";
import { useMutualisationGroups } from "../hooks/useMutualisationGroups";
import { useDismissedSuggestions } from "../hooks/useDismissedSuggestions";
import { SuggestionDialog } from "./SuggestionDialog";
import { ManualGroupDialog } from "./ManualGroupDialog";
import type { SuggestedGroup } from "../types";

export function GroupManagerPanel() {
  const { data: allSuggestions = [], isLoading: sugLoading } = useSuggestGroups();
  const { groups, isLoading: grpLoading, create, isCreating, remove, isRemoving } =
    useMutualisationGroups();
  const { dismissedHashes, isLoading: dismissLoading, dismiss, isDismissing, computeHash } =
    useDismissedSuggestions();

  const [activeSuggestion, setActiveSuggestion] = useState<SuggestedGroup | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  // Filter out dismissed suggestions
  const suggestions = useMemo(
    () =>
      allSuggestions.filter(
        (s) => !dismissedHashes.has(computeHash(s.productIds))
      ),
    [allSuggestions, dismissedHashes, computeHash]
  );

  // Track already-grouped product IDs for the manual dialog
  const existingGroupedProductIds = useMemo(
    () => new Set(groups.flatMap((g) => g.members.map((m) => m.product_id))),
    [groups]
  );

  const handleOpenSuggestion = (s: SuggestedGroup) => {
    setActiveSuggestion(s);
    setDialogOpen(true);
  };

  // Both dialogs now pass B2B data through
  const handleConfirm = (params: {
    displayName: string;
    carrierProductId: string;
    memberProductIds: string[];
    b2bBillingUnitId?: string | null;
    b2bUnitPrice?: number | null;
    b2bPriceStrategy?: string | null;
  }) => {
    create(params, {
      onSuccess: () => setDialogOpen(false),
    });
  };

  const handleManualConfirm = (params: {
    displayName: string;
    carrierProductId: string;
    memberProductIds: string[];
    b2bBillingUnitId?: string | null;
    b2bUnitPrice?: number | null;
    b2bPriceStrategy?: string | null;
  }) => {
    create(params, {
      onSuccess: () => setManualOpen(false),
    });
  };

  const isLoading = sugLoading || grpLoading || dismissLoading;

  return (
    <div className="space-y-6">
      {/* ── Manual creation button ─────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setManualOpen(true)}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Créer une mutualisation
        </Button>
      </div>

      {/* ── Existing groups ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Layers className="h-4 w-4 text-primary" />
          Groupes actifs
        </h3>

        {grpLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Aucun groupe de mutualisation créé.
          </p>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground text-sm">
                      {g.display_name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({g.members.length} produit{g.members.length > 1 ? "s" : ""})
                    </span>
                  </div>
                  {g.b2b_billing_unit_id && g.b2b_unit_price !== null && (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {g.b2b_unit_price?.toFixed(2)} € B2B
                      </Badge>
                      {g.b2b_price_strategy && (
                        <span className="text-[10px] text-muted-foreground">
                          ({g.b2b_price_strategy})
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(g.id)}
                  disabled={isRemoving}
                  aria-label={`Supprimer le groupe ${g.display_name}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Suggestions ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-accent-foreground" />
          Suggestions de regroupement
        </h3>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analyse des produits…
          </div>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Aucune suggestion de regroupement trouvée.
          </p>
        ) : (
          <div className="space-y-2">
            {suggestions.map((s, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground text-sm">
                    {s.displayName}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dismiss(s.productIds)}
                      disabled={isDismissing}
                      className="text-muted-foreground hover:text-destructive gap-1.5"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      Ignorer
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenSuggestion(s)}
                    >
                      Valider
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {s.products.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 rounded-full bg-background border border-border px-2.5 py-0.5 text-xs text-muted-foreground uppercase"
                    >
                      <Package className="h-3 w-3" />
                      {p.nom_produit}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────── */}
      <SuggestionDialog
        suggestion={activeSuggestion}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfirm={handleConfirm}
        isConfirming={isCreating}
      />

      <ManualGroupDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onConfirm={handleManualConfirm}
        isConfirming={isCreating}
        existingGroupedProductIds={existingGroupedProductIds}
      />
    </div>
  );
}
