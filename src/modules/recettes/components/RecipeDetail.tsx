/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Fiche recette détaillée (Dialog)
 * ═══════════════════════════════════════════════════════════════
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Plus, Pencil, Trash2, Utensils, X, Euro, Beaker, Scale, RefreshCw } from "lucide-react";
import { useRecipes, useRecipeTypes } from "@/modules/recettes";
import { IngredientForm } from "./IngredientForm";
import type { IngredientFormValue } from "./IngredientForm";
import type { RecipeLine } from "@/modules/recettes";
import type { SellingPriceMode } from "@/modules/recettes/types";
import { B2BListingSection } from "./B2BListingSection";
import { YieldUnitSelector } from "./YieldUnitSelector";

interface RecipeDetailProps {
  recipeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DetailView = "main" | "add" | "edit";

export function RecipeDetail({
  recipeId,
  open,
  onOpenChange,
}: RecipeDetailProps) {
  const { useRecipeDetail, addLine, updateLine, deleteLine, deleteRecipe, updateRecipe } =
    useRecipes();
  const { recipeTypes } = useRecipeTypes();
  const detailQuery = useRecipeDetail(recipeId);
  const recipe = detailQuery.data;
  const isLoading = detailQuery.isLoading;
  const isError = detailQuery.isError;

  const [view, setView] = useState<DetailView>("main");
  const [editingLine, setEditingLine] = useState<RecipeLine | null>(null);

  const typeName = useMemo(
    () => recipeTypes.find((t) => t.id === recipe?.recipe_type_id)?.name ?? "—",
    [recipeTypes, recipe?.recipe_type_id]
  );

  const handleClose = () => {
    setView("main");
    setEditingLine(null);
    onOpenChange(false);
  };

  const handleAddIngredient = async (value: IngredientFormValue) => {
    await addLine.mutateAsync({
      recipe_id: recipeId,
      product_id: value.sub_recipe_id ? null : value.product_id,
      sub_recipe_id: value.sub_recipe_id ?? null,
      quantity: value.quantity,
      unit_id: value.unit_id,
    });
    setView("main");
  };

  const handleUpdateIngredient = async (value: IngredientFormValue) => {
    if (!editingLine) return;
    await updateLine.mutateAsync({
      id: editingLine.id,
      recipe_id: recipeId,
      product_id: value.sub_recipe_id ? null : value.product_id,
      sub_recipe_id: value.sub_recipe_id ?? null,
      quantity: value.quantity,
      unit_id: value.unit_id,
    });
    setEditingLine(null);
    setView("main");
  };

  const handleDeleteLine = async () => {
    if (!editingLine) return;
    await deleteLine.mutateAsync({
      id: editingLine.id,
      recipe_id: recipeId,
    });
    setEditingLine(null);
    setView("main");
  };

  const handleDeleteRecipe = async () => {
    await deleteRecipe.mutateAsync(recipeId);
    handleClose();
  };

  const openEdit = (line: RecipeLine) => {
    setEditingLine(line);
    setView("edit");
  };

  if (isError) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <div className="h-40 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-destructive font-medium">Impossible de charger la recette</p>
            <Button variant="outline" size="sm" onClick={() => detailQuery.refetch()}>
              Réessayer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <div className="h-40 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!recipe) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <div className="h-40 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground font-medium">Recette introuvable</p>
            <Button variant="outline" size="sm" onClick={handleClose}>
              Fermer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const isPreparation = recipe.is_preparation;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {view !== "main" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 -ml-2"
                onClick={() => {
                  setView("main");
                  setEditingLine(null);
                }}
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <DialogTitle>
              {view === "main" && (
                <RecipeNameEditor
                  recipeId={recipe.id}
                  name={recipe.name}
                  updateRecipe={updateRecipe}
                />
              )}
              {view === "add" && "Ajouter un ingrédient"}
              {view === "edit" && "Modifier l'ingrédient"}
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* ═══ MAIN VIEW ═══ */}
        {view === "main" && (
          <div className="space-y-5 pt-2">
            {/* Recipe type + badges */}
            <div className="flex items-center gap-2 flex-wrap">
              {isPreparation && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                  <Beaker className="w-3 h-3" />
                  Préparation
                </span>
              )}
              <RecipeTypeBadge
                recipeId={recipe.id}
                currentTypeId={recipe.recipe_type_id}
                typeName={typeName}
                recipeTypes={recipeTypes}
                updateRecipe={updateRecipe}
              />
              {!isPreparation && (
                <PortionsEditor
                  recipeId={recipe.id}
                  portions={recipe.portions}
                  updateRecipe={updateRecipe}
                />
              )}
              {!isPreparation && (
                <SellingPriceEditor
                  recipeId={recipe.id}
                  sellingPrice={recipe.selling_price}
                  sellingPriceMode={recipe.selling_price_mode}
                  portions={recipe.portions}
                  updateRecipe={updateRecipe}
                />
              )}
            </div>

            {/* Yield info for preparations */}
            {isPreparation && (
              <YieldEditor
                recipeId={recipe.id}
                yieldQuantity={recipe.yield_quantity}
                yieldUnitId={recipe.yield_unit_id}
                updateRecipe={updateRecipe}
              />
            )}

            {/* Ingredients */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Ingrédients ({recipe.recipe_lines.length})
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 h-9"
                  onClick={() => setView("add")}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter
                </Button>
              </div>

              {recipe.recipe_lines.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Aucun ingrédient
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {recipe.recipe_lines.map((line) => (
                    <IngredientRow
                      key={line.id}
                      line={line}
                      onEdit={() => openEdit(line)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* B2B Publishing — only for plats */}
            {!isPreparation && (
              <B2BListingSection
                recipeId={recipe.id}
                recipeName={recipe.name}
                recipePortions={recipe.portions}
                recipeTypeId={recipe.recipe_type_id}
              />
            )}

            {/* Convert recipe ↔ preparation */}
            <ConvertTypeSection
              recipe={recipe}
              updateRecipe={updateRecipe}
            />

            {/* Delete recipe */}
            <div className="pt-4 border-t border-border">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive gap-1.5 w-full min-h-[40px]"
                    disabled={deleteRecipe.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                    Supprimer {isPreparation ? "la préparation" : "la recette"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Supprimer {isPreparation ? "la préparation" : "la recette"} ?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      « {recipe.name} » et tous ses ingrédients
                      seront supprimés définitivement.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteRecipe}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}

        {/* ═══ ADD VIEW ═══ */}
        {view === "add" && (
          <div className="pt-4">
            <IngredientForm
              onSubmit={handleAddIngredient}
              submitLabel="Ajouter l'ingrédient"
              allowPreparations={!isPreparation}
            />
          </div>
        )}

        {/* ═══ EDIT VIEW ═══ */}
        {view === "edit" && editingLine && (
          <div className="space-y-4 pt-4">
            <IngredientForm
              initial={{
                product_id: editingLine.product_id ?? undefined,
                sub_recipe_id: editingLine.sub_recipe_id ?? undefined,
                quantity: editingLine.quantity,
                unit_id: editingLine.unit_id,
              }}
              onSubmit={handleUpdateIngredient}
              submitLabel="Enregistrer"
              allowPreparations={!isPreparation}
            />

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full min-h-[40px] text-destructive hover:text-destructive gap-1.5"
                  disabled={deleteLine.isPending}
                >
                  <Trash2 className="w-4 h-4" />
                  Supprimer cet ingrédient
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer l'ingrédient ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cet ingrédient sera retiré de la recette.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteLine}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Supprimer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Yield editor for preparations (inline popover) ──

function useUnitLabel(unitId: string | null): string {
  const { data } = useQuery({
    queryKey: ["recipe-unit-label", unitId],
    queryFn: async () => {
      if (!unitId) return "";
      const { data, error } = await supabase
        .from("measurement_units")
        .select("abbreviation, name")
        .eq("id", unitId)
        .maybeSingle();
      if (error || !data) return "?";
      return data.abbreviation || data.name || "?";
    },
    enabled: !!unitId,
    staleTime: 30 * 60 * 1000,
  });
  return data ?? "…";
}

function YieldEditor({
  recipeId,
  yieldQuantity,
  yieldUnitId,
  updateRecipe,
}: {
  recipeId: string;
  yieldQuantity: number | null;
  yieldUnitId: string | null;
  updateRecipe: { mutateAsync: (input: { id: string; yield_quantity?: number | null; yield_unit_id?: string | null }) => Promise<void>; isPending: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [qtyValue, setQtyValue] = useState("");
  const [unitId, setUnitId] = useState<string | null>(null);
  const unitLabel = useUnitLabel(yieldUnitId);

  const handleOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setQtyValue(yieldQuantity != null ? String(yieldQuantity) : "");
      setUnitId(yieldUnitId);
    }
    setOpen(nextOpen);
  };

  const handleSave = async () => {
    const trimmed = qtyValue.trim();
    const parsed = trimmed === "" ? null : parseFloat(trimmed);
    if (parsed !== null && (isNaN(parsed) || parsed <= 0)) return;
    await updateRecipe.mutateAsync({
      id: recipeId,
      yield_quantity: parsed,
      yield_unit_id: parsed ? unitId : null,
    });
    setOpen(false);
  };

  const hasYield = yieldQuantity != null && yieldQuantity > 0;

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full rounded-lg border border-border bg-muted/20 p-4 text-left hover:bg-accent/30 transition-colors"
        >
          <div className="flex items-center gap-2 mb-1">
            <Scale className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Rendement final</p>
            <Pencil className="w-3 h-3 ml-auto text-muted-foreground opacity-50" />
          </div>
          <div className="mt-2">
            {hasYield ? (
              <span className="text-lg font-semibold text-foreground">
                {yieldQuantity} {unitLabel}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Non défini</span>
            )}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-3">
          <p className="text-xs font-medium text-foreground">Volume de la préparation</p>
          <div className="flex gap-2">
            <Input
              type="number"
              inputMode="decimal"
              min={0.01}
              step="any"
              placeholder="Ex : 3000"
              value={qtyValue}
              onChange={(e) => setQtyValue(e.target.value)}
              className="h-9 flex-1"
              autoFocus
            />
            <div className="w-24">
              <YieldUnitSelector value={unitId} onChange={setUnitId} />
            </div>
          </div>
          <Button
            size="sm"
            className="w-full h-8"
            onClick={handleSave}
            disabled={updateRecipe.isPending}
          >
            Valider
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Ingredient row ──
// Hooks are always called unconditionally; only one will be enabled at a time.

function IngredientRow({
  line,
  onEdit,
}: {
  line: RecipeLine;
  onEdit: () => void;
}) {
  const isSubRecipe = !!line.sub_recipe_id;
  const productName = useProductName(isSubRecipe ? null : line.product_id);
  const recipeName = useRecipeName(isSubRecipe ? line.sub_recipe_id! : null);
  const displayName = isSubRecipe ? recipeName : productName;

  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full text-left flex items-center rounded-lg px-4 min-h-[48px]
                 bg-muted/30 hover:bg-accent/50 transition-colors active:scale-[0.99]"
    >
      <div className="min-w-0 flex-1 py-2">
        <div className="flex items-center gap-1.5">
          {isSubRecipe && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent text-[10px] font-semibold text-accent-foreground shrink-0">
              PRÉPA
            </span>
          )}
          <p className="text-sm font-medium text-foreground truncate">
            {displayName}
          </p>
        </div>
      </div>
      <div className="flex items-center shrink-0 ml-3">
        <span className="text-sm font-medium text-muted-foreground tabular-nums w-12 text-right">
          {line.quantity}
        </span>
        <span className="ml-2 w-14">
          <UnitBadge unitId={line.unit_id} />
        </span>
      </div>
    </button>
  );
}

// ── Micro hooks for display ──

function useProductName(productId: string | null): string {
  const { data } = useQuery({
    queryKey: ["recipe-product-name", productId],
    queryFn: async () => {
      if (!productId) return "—";
      const { data, error } = await supabase
        .from("products_v2")
        .select("nom_produit")
        .eq("id", productId)
        .maybeSingle();
      if (error || !data) return "Produit supprimé";
      return data.nom_produit;
    },
    enabled: !!productId,
    staleTime: 30 * 60 * 1000,
  });
  return data ?? "…";
}

function useRecipeName(recipeId: string | null): string {
  const { data } = useQuery({
    queryKey: ["recipe-sub-name", recipeId],
    queryFn: async () => {
      if (!recipeId) return "—";
      const { data, error } = await supabase
        .from("recipes")
        .select("name")
        .eq("id", recipeId)
        .maybeSingle();
      if (error || !data) return "Préparation supprimée";
      return data.name;
    },
    enabled: !!recipeId,
    staleTime: 30 * 60 * 1000,
  });
  return data ?? "…";
}

function UnitBadge({ unitId }: { unitId: string }) {
  const { data } = useQuery({
    queryKey: ["recipe-unit-label", unitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("measurement_units")
        .select("abbreviation, name")
        .eq("id", unitId)
        .maybeSingle();
      if (error || !data) return "?";
      const abbr = data.abbreviation?.toLowerCase();
      const SHORT = new Set(["kg", "g", "l", "ml", "cl"]);
      if (abbr && SHORT.has(abbr)) return data.abbreviation;
      return data.name || data.abbreviation;
    },
    staleTime: 30 * 60 * 1000,
  });

  return (
    <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">
      {data ?? "…"}
    </span>
  );
}

// ── Portions editor (popover) ──

function PortionsEditor({
  recipeId,
  portions,
  updateRecipe,
}: {
  recipeId: string;
  portions: number | null;
  updateRecipe: { mutateAsync: (input: { id: string; portions?: number | null }) => Promise<void>; isPending: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const handleOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setValue(portions != null && portions >= 1 ? String(portions) : "");
    }
    setOpen(nextOpen);
  };

  const handleSave = async () => {
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : parseInt(trimmed, 10);
    if (parsed !== null && (isNaN(parsed) || parsed < 1)) return;
    await updateRecipe.mutateAsync({ id: recipeId, portions: parsed });
    setOpen(false);
  };

  const handleRemove = async () => {
    await updateRecipe.mutateAsync({ id: recipeId, portions: null });
    setOpen(false);
  };

  const hasPortions = portions != null && portions >= 1;

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-muted text-xs font-medium text-muted-foreground hover:bg-accent/50 transition-colors"
        >
          <Utensils className="w-3 h-3" />
          {hasPortions ? `${portions} portions` : "Portions"}
          <Pencil className="w-2.5 h-2.5 ml-0.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <div className="space-y-3">
          <p className="text-xs font-medium text-foreground">Nombre de portions</p>
          <Input
            type="number"
            min={1}
            placeholder="Ex : 12"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-9"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 h-8"
              onClick={handleSave}
              disabled={updateRecipe.isPending}
            >
              Valider
            </Button>
            {hasPortions && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-destructive hover:text-destructive gap-1"
                onClick={handleRemove}
                disabled={updateRecipe.isPending}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Selling price + mode editor (popover) ──

function SellingPriceEditor({
  recipeId,
  sellingPrice,
  sellingPriceMode,
  portions,
  updateRecipe,
}: {
  recipeId: string;
  sellingPrice: number | null;
  sellingPriceMode: SellingPriceMode;
  portions: number | null;
  updateRecipe: { mutateAsync: (input: { id: string; selling_price?: number | null; selling_price_mode?: SellingPriceMode }) => Promise<void>; isPending: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<SellingPriceMode>("per_recipe");

  const isPortionable = portions != null && portions >= 1;

  const handleOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setValue(sellingPrice != null ? String(sellingPrice) : "");
      setMode(sellingPriceMode ?? "per_recipe");
    }
    setOpen(nextOpen);
  };

  const handleSave = async () => {
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : Math.round(parseFloat(trimmed) * 100) / 100;
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) return;
    await updateRecipe.mutateAsync({
      id: recipeId,
      selling_price: parsed,
      selling_price_mode: isPortionable ? mode : "per_recipe",
    });
    setOpen(false);
  };

  const handleRemove = async () => {
    await updateRecipe.mutateAsync({
      id: recipeId,
      selling_price: null,
      selling_price_mode: "per_recipe",
    });
    setOpen(false);
  };

  const hasPrice = sellingPrice != null && sellingPrice > 0;

  // Badge label
  let badgeLabel = "Prix de vente";
  if (hasPrice) {
    const suffix = isPortionable && sellingPriceMode === "per_portion" ? " / port." : "";
    badgeLabel = `${sellingPrice.toFixed(2)} €${suffix}`;
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-muted text-xs font-medium text-muted-foreground hover:bg-accent/50 transition-colors"
        >
          <Euro className="w-3 h-3" />
          {badgeLabel}
          <Pencil className="w-2.5 h-2.5 ml-0.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-3">
          <p className="text-xs font-medium text-foreground">Prix de vente</p>
          <div className="relative">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="Ex : 12.50"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-9 pr-7"
              autoFocus
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">€</span>
          </div>

          {/* Mode selector for portionable recipes */}
          {isPortionable && (
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as SellingPriceMode)}
              className="grid gap-1.5"
            >
              <label
                className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2 cursor-pointer
                           hover:bg-accent/30 transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
              >
                <RadioGroupItem value="per_portion" />
                <span className="text-xs font-medium text-foreground">Par portion</span>
              </label>
              <label
                className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2 cursor-pointer
                           hover:bg-accent/30 transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
              >
                <RadioGroupItem value="per_recipe" />
                <span className="text-xs font-medium text-foreground">Recette entière ({portions}p)</span>
              </label>
            </RadioGroup>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 h-8"
              onClick={handleSave}
              disabled={updateRecipe.isPending}
            >
              Valider
            </Button>
            {hasPrice && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-destructive hover:text-destructive gap-1"
                onClick={handleRemove}
                disabled={updateRecipe.isPending}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * RecipeNameEditor — Inline editable name in header
 * ═══════════════════════════════════════════════════════════════ */

function RecipeNameEditor({
  recipeId,
  name,
  updateRecipe,
}: {
  recipeId: string;
  name: string;
  updateRecipe: { mutateAsync: (input: { id: string; name?: string }) => Promise<void>; isPending: boolean };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(name);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, name]);

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }
    if (trimmed !== name) {
      await updateRecipe.mutateAsync({ id: recipeId, name: trimmed });
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(name);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape") cancel();
          }}
          onBlur={save}
          disabled={updateRecipe.isPending}
          className="text-lg font-semibold text-foreground bg-transparent border-b border-border
                     focus:border-primary focus:outline-none py-0 px-0 w-full min-w-0"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 cursor-pointer group"
      onClick={() => setEditing(true)}
    >
      {name}
      <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </span>
  );
}

// ── Convert recipe ↔ preparation ──

function ConvertTypeSection({
  recipe,
  updateRecipe,
}: {
  recipe: { id: string; is_preparation: boolean; yield_quantity: number | null; yield_unit_id: string | null; recipe_lines: { sub_recipe_id: string | null }[] };
  updateRecipe: { mutateAsync: (input: { id: string; is_preparation?: boolean; yield_quantity?: number | null; yield_unit_id?: string | null; portions?: number | null; selling_price?: number | null; selling_price_mode?: SellingPriceMode }) => Promise<void>; isPending: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [yieldQty, setYieldQty] = useState("");
  const [yieldUnitId, setYieldUnitId] = useState<string | null>(null);

  const isPrep = recipe.is_preparation;
  const hasSubRecipes = recipe.recipe_lines.some((l) => !!l.sub_recipe_id);

  const handleOpen = (nextOpen: boolean) => {
    if (nextOpen && !isPrep) {
      // Converting to preparation: reset yield fields
      setYieldQty(recipe.yield_quantity ? String(recipe.yield_quantity) : "");
      setYieldUnitId(recipe.yield_unit_id);
    }
    setOpen(nextOpen);
  };

  const handleConvertToPrep = async () => {
    const qty = parseFloat(yieldQty);
    if (isNaN(qty) || qty <= 0 || !yieldUnitId) return;
    await updateRecipe.mutateAsync({
      id: recipe.id,
      is_preparation: true,
      yield_quantity: qty,
      yield_unit_id: yieldUnitId,
      portions: null,
      selling_price: null,
      selling_price_mode: "per_recipe",
    });
    setOpen(false);
  };

  const handleConvertToRecipe = async () => {
    await updateRecipe.mutateAsync({
      id: recipe.id,
      is_preparation: false,
      yield_quantity: null,
      yield_unit_id: null,
    });
    setOpen(false);
  };

  return (
    <div className="pt-2 border-t border-border">
      <Popover open={open} onOpenChange={handleOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 w-full min-h-[40px] text-muted-foreground"
          >
            <RefreshCw className="w-4 h-4" />
            {isPrep ? "Convertir en recette" : "Convertir en préparation"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-4" align="center">
          {isPrep ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">
                Convertir en recette ?
              </p>
              <p className="text-xs text-muted-foreground">
                Le rendement sera supprimé. Vous pourrez ensuite ajouter des portions et un prix de vente.
              </p>
              <Button
                size="sm"
                className="w-full"
                onClick={handleConvertToRecipe}
                disabled={updateRecipe.isPending}
              >
                Convertir en recette
              </Button>
            </div>
          ) : hasSubRecipes ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">
                Conversion impossible
              </p>
              <p className="text-xs text-muted-foreground">
                Cette recette contient des sous-recettes (préparations). Une préparation ne peut pas elle-même contenir d'autres préparations. Retirez-les d'abord.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setOpen(false)}
              >
                Compris
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">
                Convertir en préparation
              </p>
              <p className="text-xs text-muted-foreground">
                Les portions et le prix de vente seront supprimés. Définissez le rendement final.
              </p>
              <div className="space-y-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step="0.01"
                  placeholder="Volume de la préparation"
                  value={yieldQty}
                  onChange={(e) => setYieldQty(e.target.value)}
                  className="h-9"
                  autoFocus
                />
                <YieldUnitSelector
                  value={yieldUnitId}
                  onChange={setYieldUnitId}
                />
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={handleConvertToPrep}
                disabled={updateRecipe.isPending || !yieldQty || !yieldUnitId}
              >
                Convertir en préparation
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * RecipeTypeBadge — Clickable type badge with dropdown to reassign
 * ═══════════════════════════════════════════════════════════════ */

function RecipeTypeBadge({
  recipeId,
  currentTypeId,
  typeName,
  recipeTypes,
  updateRecipe,
}: {
  recipeId: string;
  currentTypeId: string | null;
  typeName: string;
  recipeTypes: { id: string; name: string }[];
  updateRecipe: { mutateAsync: (input: { id: string; recipe_type_id?: string }) => Promise<void>; isPending: boolean };
}) {
  const [open, setOpen] = useState(false);

  const handleSelect = async (typeId: string) => {
    if (typeId === currentTypeId) {
      setOpen(false);
      return;
    }
    await updateRecipe.mutateAsync({ id: recipeId, recipe_type_id: typeId });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center px-3 py-1 rounded-full bg-muted text-xs font-medium text-muted-foreground hover:bg-muted/80 transition-colors cursor-pointer">
          {typeName}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <p className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Déplacer vers
        </p>
        {recipeTypes.map((t) => (
          <button
            key={t.id}
            onClick={() => handleSelect(t.id)}
            disabled={updateRecipe.isPending}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              t.id === currentTypeId
                ? "bg-primary/10 text-primary font-medium"
                : "text-foreground hover:bg-accent/50"
            }`}
          >
            {t.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
