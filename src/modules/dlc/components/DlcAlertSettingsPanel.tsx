/**
 * DLC V1 — Settings panel for DLC alert thresholds.
 * Placed in Produits V2 → Paramètres Alertes tab.
 *
 * Allows configuring:
 * 1. Global default warning days per establishment
 * 2. Category-level overrides
 *
 * Product-level overrides are set in the product wizard.
 */

import { useState, useEffect, useMemo } from "react";
import { ShieldAlert, Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useDlcAlertSettings, useUpsertDlcAlertSettings } from "../hooks/useDlcAlertSettings";
import { useProductCategories } from "@/modules/produitsV2/hooks/useProductCategories";
import { DLC_DEFAULT_WARNING_DAYS } from "../types";

interface CategoryOverride {
  categoryId: string;
  categoryName: string;
  days: number;
}

export function DlcAlertSettingsPanel() {
  const { settings, isLoading: settingsLoading, defaultWarningDays } = useDlcAlertSettings();
  const upsert = useUpsertDlcAlertSettings();
  const { categories, isLoading: categoriesLoading } = useProductCategories();

  const [globalDays, setGlobalDays] = useState(DLC_DEFAULT_WARNING_DAYS);
  const [categoryOverrides, setCategoryOverrides] = useState<CategoryOverride[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");

  // Build category id→name map
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  // Available categories (not yet added)
  const availableCategories = useMemo(
    () => categories.filter((c) => !categoryOverrides.some((o) => o.categoryId === c.id)),
    [categories, categoryOverrides]
  );

  // Sync from DB
  useEffect(() => {
    if (settings && categories.length > 0) {
      setGlobalDays(settings.default_warning_days);
      const overrides: CategoryOverride[] = [];
      for (const [catId, days] of Object.entries(settings.category_thresholds)) {
        const name = categoryMap.get(catId);
        if (name) {
          overrides.push({ categoryId: catId, categoryName: name, days });
        }
      }
      setCategoryOverrides(overrides);
    } else if (!settings) {
      setGlobalDays(DLC_DEFAULT_WARNING_DAYS);
      setCategoryOverrides([]);
    }
  }, [settings, categories, categoryMap]);

  const handleSave = () => {
    const catThresholds: Record<string, number> = {};
    for (const o of categoryOverrides) {
      catThresholds[o.categoryId] = o.days;
    }

    upsert.mutate(
      { default_warning_days: globalDays, category_thresholds: catThresholds },
      {
        onSuccess: () => toast.success("Paramètres DLC enregistrés"),
        onError: () => toast.error("Erreur lors de l'enregistrement"),
      }
    );
  };

  const addCategory = () => {
    if (!selectedCategoryId) return;
    const cat = categories.find((c) => c.id === selectedCategoryId);
    if (!cat) return;
    setCategoryOverrides((prev) => [
      ...prev,
      { categoryId: cat.id, categoryName: cat.name, days: globalDays },
    ]);
    setSelectedCategoryId("");
  };

  const removeCategory = (index: number) => {
    setCategoryOverrides((prev) => prev.filter((_, i) => i !== index));
  };

  const updateCategoryDays = (index: number, days: number) => {
    setCategoryOverrides((prev) =>
      prev.map((o, i) => (i === index ? { ...o, days } : o))
    );
  };

  if (settingsLoading || categoriesLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Chargement…</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          <div>
            <CardTitle className="text-lg">Alertes DLC</CardTitle>
            <CardDescription>
              Définissez combien de jours avant l'expiration les alertes doivent se déclencher.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Global default */}
        <div className="space-y-2">
          <Label htmlFor="dlc-global-days">Alerte par défaut (jours)</Label>
          <div className="flex items-center gap-2 max-w-xs">
            <Input
              id="dlc-global-days"
              type="number"
              min={0}
              max={365}
              step={1}
              value={globalDays}
              onChange={(e) => setGlobalDays(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">
              Alerte si DLC ≤ {globalDays} jours
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Appliqué à tous les produits sauf ceux avec un seuil catégorie ou produit.
          </p>
        </div>

        {/* Category overrides */}
        <div className="space-y-3">
          <Label>Seuils par catégorie (surcharge du global)</Label>

          {categoryOverrides.length > 0 && (
            <div className="space-y-2">
              {categoryOverrides.map((override, index) => (
                <div key={override.categoryId} className="flex items-center gap-2">
                  <Badge variant="outline" className="min-w-[120px] justify-center">
                    {override.categoryName}
                  </Badge>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    value={override.days}
                    onChange={(e) => updateCategoryDays(index, Number(e.target.value))}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">jours</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    onClick={() => removeCategory(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
              <SelectTrigger className="max-w-[200px]">
                <SelectValue placeholder="Sélectionner une catégorie" />
              </SelectTrigger>
              <SelectContent>
                {availableCategories.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    {categories.length === 0
                      ? "Aucune catégorie configurée"
                      : "Toutes les catégories ont un seuil"}
                  </div>
                ) : (
                  availableCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={addCategory} disabled={!selectedCategoryId}>
              <Plus className="h-4 w-4 mr-1" />
              Ajouter
            </Button>
          </div>

          {categoryOverrides.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Aucune surcharge. Toutes les catégories utilisent le seuil global ({globalDays} jours).
            </p>
          )}
        </div>

        {/* Priority explanation */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
          <p className="text-xs font-medium">Ordre de priorité :</p>
          <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-0.5">
            <li>Seuil défini sur le <strong>produit</strong> (dans le wizard)</li>
            <li>Seuil de la <strong>catégorie</strong> (ci-dessus)</li>
            <li>Seuil <strong>global</strong> de l'établissement ({globalDays} jours)</li>
            <li>Fallback système ({DLC_DEFAULT_WARNING_DAYS} jours)</li>
          </ol>
        </div>

        {/* Save */}
        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={upsert.isPending}>
            <Save className="h-4 w-4 mr-2" />
            Enregistrer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
