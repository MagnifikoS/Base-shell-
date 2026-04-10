/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Wizard de création (3 étapes)
 * ═══════════════════════════════════════════════════════════════
 *
 * Step 1: Nom + Type + Mode (Plat / Préparation) + Portions/Rendement
 * Step 2: Ingredient loop (product/preparation + qty + unit)
 * Step 3: Summary + Prix de vente optionnel + mode → validate
 */

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Trash2, Check, Beaker } from "lucide-react";
import { useRecipeTypes, useRecipes } from "@/modules/recettes";
import { IngredientForm } from "./IngredientForm";
import type { IngredientFormValue } from "./IngredientForm";
import type { SellingPriceMode } from "@/modules/recettes/types";
import { YieldUnitSelector } from "./YieldUnitSelector";

interface RecipeWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type WizardStep = 1 | 2 | 3;

export function RecipeWizard({ open, onOpenChange }: RecipeWizardProps) {
  const { recipeTypes } = useRecipeTypes();
  const { createRecipe } = useRecipes();

  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState<string | null>(null);
  const [isPreparation, setIsPreparation] = useState(false);
  const [hasPortions, setHasPortions] = useState(false);
  const [portionsValue, setPortionsValue] = useState<string>("");
  const [yieldValue, setYieldValue] = useState<string>("");
  const [yieldUnitId, setYieldUnitId] = useState<string | null>(null);
  const [sellingPriceValue, setSellingPriceValue] = useState<string>("");
  const [sellingPriceMode, setSellingPriceMode] = useState<SellingPriceMode>("per_recipe");
  const [ingredients, setIngredients] = useState<IngredientFormValue[]>([]);
  const [step, setStep] = useState<WizardStep>(1);
  const [formKey, setFormKey] = useState(0);

  const reset = () => {
    setName("");
    setTypeId(null);
    setIsPreparation(false);
    setHasPortions(false);
    setPortionsValue("");
    setYieldValue("");
    setYieldUnitId(null);
    setSellingPriceValue("");
    setSellingPriceMode("per_recipe");
    setIngredients([]);
    setStep(1);
    setFormKey(0);
  };

  const handleClose = () => {
    onOpenChange(false);
    reset();
  };

  const parsedPortions = hasPortions ? parseInt(portionsValue, 10) : null;
  const portionsValid = !hasPortions || (parsedPortions != null && parsedPortions >= 1);
  const parsedYield = yieldValue.trim() ? parseFloat(yieldValue) : null;
  const yieldValid = !isPreparation || (parsedYield != null && parsedYield > 0 && !!yieldUnitId);

  const step1Valid = name.trim().length > 0 && !!typeId && (isPreparation ? yieldValid : portionsValid);
  const isPortionable = !isPreparation && hasPortions && parsedPortions != null && parsedPortions >= 1;

  const handleAddIngredient = useCallback((value: IngredientFormValue) => {
    setIngredients((prev) => [...prev, value]);
    setFormKey((k) => k + 1);
  }, []);

  const handleRemoveIngredient = (index: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  };

  const parsedSellingPrice = sellingPriceValue.trim() === ""
    ? null
    : parseFloat(sellingPriceValue);

  const handleCreate = async () => {
    if (!typeId) return;
    await createRecipe.mutateAsync({
      name,
      recipe_type_id: typeId,
      is_preparation: isPreparation,
      portions: isPortionable ? parsedPortions : null,
      yield_quantity: isPreparation ? parsedYield : null,
      yield_unit_id: isPreparation ? yieldUnitId : null,
      selling_price: !isPreparation && parsedSellingPrice != null && parsedSellingPrice >= 0 ? parsedSellingPrice : null,
      selling_price_mode: isPortionable ? sellingPriceMode : "per_recipe",
      lines: ingredients.map((ing) => ({
        product_id: ing.sub_recipe_id ? null : ing.product_id,
        sub_recipe_id: ing.sub_recipe_id ?? null,
        quantity: ing.quantity,
        unit_id: ing.unit_id,
      })),
    });
    handleClose();
  };

  const selectedTypeName = recipeTypes.find((t) => t.id === typeId)?.name;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 -ml-2"
                onClick={() => setStep((s) => (s - 1) as WizardStep)}
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <DialogTitle>
              {step === 1 && (isPreparation ? "Nouvelle préparation" : "Nouvelle recette")}
              {step === 2 && "Ingrédients"}
              {step === 3 && "Résumé"}
            </DialogTitle>
          </div>
          {/* Step indicator */}
          <div className="flex gap-1.5 pt-3">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                  s <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </DialogHeader>

        {/* ═══ STEP 1: Name + Type + Mode + Portions/Yield ═══ */}
        {step === 1 && (
          <div className="space-y-6 pt-4">
            {/* Plat / Préparation toggle */}
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Beaker className="w-4 h-4 text-muted-foreground" />
                  <Label htmlFor="prep-toggle" className="text-sm font-medium text-foreground cursor-pointer">
                    Préparation cuisine
                  </Label>
                </div>
                <Switch
                  id="prep-toggle"
                  checked={isPreparation}
                  onCheckedChange={(checked) => {
                    setIsPreparation(checked);
                    if (checked) {
                      setHasPortions(false);
                      setPortionsValue("");
                      setSellingPriceValue("");
                    }
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {isPreparation
                  ? "Sauce, pâte, fond… utilisable dans d'autres recettes"
                  : "Plat vendu au client (par défaut)"}
              </p>
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block">
                Nom {isPreparation ? "de la préparation" : "de la recette"}
              </label>
              <Input
                placeholder={isPreparation ? "Ex : Sauce tomate" : "Ex : Pâtes arrabiata"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 block">
                Type de recette
              </label>
              {recipeTypes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Allez dans paramètres et créez des types de recette (exemple : Plat, Dessert…)
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {recipeTypes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTypeId(t.id)}
                      className={`
                        min-h-[40px] px-5 py-2 rounded-full text-sm font-medium 
                        transition-all active:scale-95
                        ${
                          typeId === t.id
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }
                      `}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Conditional: Portions (plat) or Yield (préparation) */}
            {isPreparation ? (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <p className="text-sm font-medium text-foreground">Rendement final</p>
                <p className="text-xs text-muted-foreground">
                  Quantité obtenue après cuisson / préparation
                </p>
                <div className="flex gap-3">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    placeholder="Ex : 3000"
                    value={yieldValue}
                    onChange={(e) => setYieldValue(e.target.value)}
                    className="h-10 flex-1"
                  />
                  <div className="w-28">
                    <YieldUnitSelector
                      value={yieldUnitId}
                      onChange={setYieldUnitId}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="portions-toggle" className="text-sm font-medium text-foreground cursor-pointer">
                    Recette portionnable
                  </Label>
                  <Switch
                    id="portions-toggle"
                    checked={hasPortions}
                    onCheckedChange={(checked) => {
                      setHasPortions(checked);
                      if (!checked) {
                        setPortionsValue("");
                        setSellingPriceMode("per_recipe");
                      }
                    }}
                  />
                </div>
                {hasPortions && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      Nombre de portions
                    </label>
                    <Input
                      type="number"
                      min={1}
                      placeholder="Ex : 12"
                      value={portionsValue}
                      onChange={(e) => setPortionsValue(e.target.value)}
                      className="h-10"
                    />
                  </div>
                )}
              </div>
            )}

            <Button
              className="w-full min-h-[44px]"
              disabled={!step1Valid}
              onClick={() => setStep(2)}
            >
              Continuer
            </Button>
          </div>
        )}

        {/* ═══ STEP 2: Ingredient loop ═══ */}
        {step === 2 && (
          <div className="space-y-5 pt-4">
            {ingredients.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Ingrédients ajoutés ({ingredients.length})
                </p>
                <div className="space-y-1.5">
                  {ingredients.map((ing, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 min-h-[48px]"
                    >
                      <div className="min-w-0 py-2 flex-1">
                        <div className="flex items-center gap-1.5">
                          {ing.sub_recipe_id && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent text-[10px] font-semibold text-accent-foreground shrink-0">
                              PRÉPA
                            </span>
                          )}
                          <p className="text-sm font-medium text-foreground truncate">
                            {ing.product_name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={ing.quantity}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (isNaN(val) && e.target.value !== "") return;
                            setIngredients((prev) =>
                              prev.map((item, idx) =>
                                idx === i
                                  ? { ...item, quantity: e.target.value === "" ? 0 : val }
                                  : item
                              )
                            );
                          }}
                          className="h-8 w-16 text-xs px-2 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-xs text-muted-foreground w-8">
                          {ing.unit_label}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
                        onClick={() => handleRemoveIngredient(i)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <IngredientForm
              key={formKey}
              onSubmit={handleAddIngredient}
              submitLabel="Ajouter l'ingrédient"
              allowPreparations={!isPreparation}
            />

            {ingredients.length > 0 && (
              <Button
                variant="outline"
                className="w-full min-h-[44px]"
                onClick={() => setStep(3)}
              >
                Terminer · {ingredients.length} ingrédient
                {ingredients.length > 1 ? "s" : ""}
              </Button>
            )}
          </div>
        )}

        {/* ═══ STEP 3: Summary + Selling price ═══ */}
        {step === 3 && (
          <div className="space-y-6 pt-4">
            {/* Recipe info */}
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                {isPreparation && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-accent text-[10px] font-semibold text-accent-foreground">
                    PRÉPA
                  </span>
                )}
                <p className="text-lg font-semibold text-foreground">{name}</p>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {selectedTypeName}
                {isPreparation && parsedYield && (
                  <> · Rendement : {parsedYield}</>
                )}
                {isPortionable && (
                  <> · {parsedPortions} portions</>
                )}
              </p>
            </div>

            {/* Ingredients list */}
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                Ingrédients ({ingredients.length})
              </p>
              <div className="space-y-1">
                {ingredients.map((ing, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg px-4 min-h-[40px] bg-muted/30"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {ing.sub_recipe_id && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent text-[10px] font-semibold text-accent-foreground shrink-0">
                          PRÉPA
                        </span>
                      )}
                      <span className="text-sm text-foreground truncate">
                        {ing.product_name}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-muted-foreground shrink-0 ml-3">
                      {ing.quantity} {ing.unit_label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Selling price (optional) — only for plats */}
            {!isPreparation && (
              <div className="space-y-3">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground block">
                  Prix de vente (optionnel)
                </label>
                <div className="relative">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="Ex : 12.50"
                    value={sellingPriceValue}
                    onChange={(e) => setSellingPriceValue(e.target.value)}
                    className="h-11 pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
                </div>

                {/* Mode selector — only for portionable recipes with a price */}
                {isPortionable && sellingPriceValue.trim() !== "" && (
                  <RadioGroup
                    value={sellingPriceMode}
                    onValueChange={(v) => setSellingPriceMode(v as SellingPriceMode)}
                    className="grid gap-2"
                  >
                    <label
                      className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 cursor-pointer
                                 hover:bg-accent/30 transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
                    >
                      <RadioGroupItem value="per_portion" id="sp-portion" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Prix par portion</p>
                        <p className="text-xs text-muted-foreground">Le prix saisi correspond à 1 portion</p>
                      </div>
                    </label>
                    <label
                      className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 cursor-pointer
                                 hover:bg-accent/30 transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
                    >
                      <RadioGroupItem value="per_recipe" id="sp-recipe" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Prix de la recette entière</p>
                        <p className="text-xs text-muted-foreground">Le prix saisi correspond aux {parsedPortions} portions</p>
                      </div>
                    </label>
                  </RadioGroup>
                )}
              </div>
            )}

            {/* Create */}
            <Button
              className="w-full min-h-[44px] gap-2"
              disabled={createRecipe.isPending}
              onClick={handleCreate}
            >
              <Check className="w-4 h-4" />
              {isPreparation ? "Créer la préparation" : "Créer la recette"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
