/**
 * Section B2B dans la fiche recette fournisseur.
 * Permet d'activer/désactiver la commercialisation B2B,
 * de définir un prix B2B fixe, un nom commercial et les portions.
 *
 * Étape 2 — Initialisation depuis la recette source à la première publication,
 * puis édition autonome de la fiche commerciale.
 *
 * Règle : la recette interne ne réécrit jamais la fiche commerciale
 * une fois celle-ci créée.
 */

import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Store, Euro, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useRecipeB2BListing } from "../hooks/useRecipeB2BListing";
import type { UpsertB2BListingInput } from "../hooks/useRecipeB2BListing";

interface B2BListingSectionProps {
  recipeId: string;
  /** Données de la recette source — pour initialisation à la première publication */
  recipeName: string;
  recipePortions: number | null;
  recipeTypeId: string | null;
}

export function B2BListingSection({
  recipeId,
  recipeName,
  recipePortions,
  recipeTypeId,
}: B2BListingSectionProps) {
  const { listing, isLoading, upsert } = useRecipeB2BListing(recipeId);

  const isPublished = listing?.is_published ?? false;
  const currentPrice = listing?.b2b_price ?? 0;
  const commercialName = listing?.commercial_name || "";
  const portions = listing?.portions ?? null;

  const [priceInput, setPriceInput] = useState("");
  const [editingPrice, setEditingPrice] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingName, setEditingName] = useState(false);

  // Sync name input when listing loads
  useEffect(() => {
    if (listing?.commercial_name) {
      setNameInput(listing.commercial_name);
    }
  }, [listing?.commercial_name]);

  /**
   * Build the full upsert payload.
   * If no listing exists yet (first publish), we snapshot from the recipe source.
   * If listing already exists, we preserve existing commercial values.
   */
  const buildPayload = (overrides: Partial<UpsertB2BListingInput>): UpsertB2BListingInput => {
    const isFirstPublish = !listing;

    return {
      is_published: overrides.is_published ?? isPublished,
      b2b_price: overrides.b2b_price ?? currentPrice,
      commercial_name:
        overrides.commercial_name ??
        (isFirstPublish ? recipeName : commercialName),
      portions:
        overrides.portions !== undefined
          ? overrides.portions
          : (isFirstPublish ? recipePortions : portions),
      recipe_type_id:
        overrides.recipe_type_id !== undefined
          ? overrides.recipe_type_id
          : (isFirstPublish ? recipeTypeId : (listing?.recipe_type_id ?? recipeTypeId)),
    };
  };

  const handleToggle = async (checked: boolean) => {
    try {
      await upsert.mutateAsync(buildPayload({ is_published: checked }));
      toast.success(checked ? "Recette publiée en B2B" : "Publication B2B désactivée");
    } catch {
      toast.error("Erreur lors de la mise à jour");
    }
  };

  const handlePriceSave = async () => {
    const parsed = Math.round(parseFloat(priceInput) * 100) / 100;
    if (isNaN(parsed) || parsed < 0) return;
    try {
      await upsert.mutateAsync(buildPayload({ b2b_price: parsed }));
      toast.success("Prix B2B mis à jour");
      setEditingPrice(false);
    } catch {
      toast.error("Erreur lors de la mise à jour du prix");
    }
  };

  const handleNameSave = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    try {
      await upsert.mutateAsync(buildPayload({ commercial_name: trimmed }));
      toast.success("Nom commercial mis à jour");
      setEditingName(false);
    } catch {
      toast.error("Erreur lors de la mise à jour du nom");
    }
  };

  const startPriceEdit = () => {
    setPriceInput(currentPrice > 0 ? String(currentPrice) : "");
    setEditingPrice(true);
  };

  const startNameEdit = () => {
    setNameInput(commercialName || recipeName);
    setEditingName(true);
  };

  if (isLoading) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      {/* Toggle publication */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Store className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            Commercialisation B2B
          </span>
        </div>
        <Switch
          checked={isPublished}
          onCheckedChange={handleToggle}
          disabled={upsert.isPending}
        />
      </div>

      {isPublished && (
        <div className="space-y-3 pt-1">
          {/* Commercial name */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Nom commercial (visible par les clients)
            </p>
            {editingName ? (
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="Nom commercial du plat"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="h-9 flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleNameSave();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                />
                <Button
                  size="sm"
                  className="h-9"
                  onClick={handleNameSave}
                  disabled={upsert.isPending}
                >
                  Valider
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setEditingName(false)}
                >
                  Annuler
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startNameEdit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm font-medium text-foreground hover:bg-accent/50 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                {commercialName || recipeName}
              </button>
            )}
          </div>

          {/* B2B Price */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Prix B2B (distinct du prix de vente interne)
            </p>
            {editingPrice ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="Ex : 15.00"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    className="h-9 pr-7"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handlePriceSave();
                      if (e.key === "Escape") setEditingPrice(false);
                    }}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    €
                  </span>
                </div>
                <Button
                  size="sm"
                  className="h-9"
                  onClick={handlePriceSave}
                  disabled={upsert.isPending}
                >
                  Valider
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setEditingPrice(false)}
                >
                  Annuler
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startPriceEdit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm font-medium text-foreground hover:bg-accent/50 transition-colors"
              >
                <Euro className="w-3.5 h-3.5" />
                {currentPrice > 0 ? `${currentPrice.toFixed(2)} €` : "Définir le prix"}
              </button>
            )}
          </div>

          {/* Portions display */}
          {(portions ?? recipePortions) != null && (
            <p className="text-xs text-muted-foreground">
              Portions : {portions ?? recipePortions}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
