/**
 * Module Alertes Prix V0 — Paramétrage des seuils
 * SSOT catégories = product_categories (UUID keys in category_thresholds)
 */
import { useState, useEffect, useMemo } from "react";
import { Settings, Plus, Trash2, Save, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { usePriceAlertSettings, useUpsertAlertSettings } from "../hooks/usePriceAlerts";
import { useProductCategories } from "@/modules/produitsV2/hooks/useProductCategories";

interface Props {
  establishmentId: string;
}

interface CategoryOverride {
  categoryId: string;
  categoryName: string;
  threshold: number;
}

export function PriceAlertSettingsPanel({ establishmentId }: Props) {
  const { data: settings, isLoading } = usePriceAlertSettings(establishmentId);
  const upsert = useUpsertAlertSettings(establishmentId);
  const { categories, isLoading: categoriesLoading } = useProductCategories();

  const [enabled, setEnabled] = useState(false);
  const [globalThreshold, setGlobalThreshold] = useState(5);
  const [categoryOverrides, setCategoryOverrides] = useState<CategoryOverride[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");

  // Build a map id→name for resolving stored UUIDs
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  // Categories not yet added as overrides
  const availableCategories = useMemo(
    () => categories.filter((c) => !categoryOverrides.some((o) => o.categoryId === c.id)),
    [categories, categoryOverrides]
  );

  // Sync local state when data loads
  useEffect(() => {
    if (settings && categories.length > 0) {
      setEnabled(settings.enabled);
      setGlobalThreshold(settings.global_threshold_pct);
      const overrides: CategoryOverride[] = [];
      for (const [key, threshold] of Object.entries(settings.category_thresholds)) {
        // key is a category_id (UUID)
        const name = categoryMap.get(key);
        if (name) {
          overrides.push({ categoryId: key, categoryName: name, threshold });
        }
        // Skip orphaned keys (category deleted/archived)
      }
      setCategoryOverrides(overrides);
    }
  }, [settings, categories, categoryMap]);

  const handleSave = () => {
    const catThresholds: Record<string, number> = {};
    for (const o of categoryOverrides) {
      catThresholds[o.categoryId] = o.threshold;
    }

    upsert.mutate(
      {
        enabled,
        global_threshold_pct: globalThreshold,
        category_thresholds: catThresholds,
      },
      {
        onSuccess: () => toast.success("Paramètres des alertes prix enregistrés"),
        onError: () => toast.error("Erreur lors de l'enregistrement"),
      }
    );
  };

  const addCategory = () => {
    if (!selectedCategoryId) return;
    const cat = categories.find((c) => c.id === selectedCategoryId);
    if (!cat) return;
    if (categoryOverrides.some((o) => o.categoryId === cat.id)) {
      toast.error("Cette catégorie existe déjà");
      return;
    }
    setCategoryOverrides((prev) => [
      ...prev,
      { categoryId: cat.id, categoryName: cat.name, threshold: globalThreshold },
    ]);
    setSelectedCategoryId("");
  };

  const removeCategory = (index: number) => {
    setCategoryOverrides((prev) => prev.filter((_, i) => i !== index));
  };

  const updateCategoryThreshold = (index: number, threshold: number) => {
    setCategoryOverrides((prev) =>
      prev.map((o, i) => (i === index ? { ...o, threshold } : o))
    );
  };

  if (isLoading || categoriesLoading) {
    return <div className="p-6 text-muted-foreground">Chargement…</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-lg">Alertes de variation de prix</CardTitle>
              <CardDescription>
                Recevez une alerte quand un fournisseur modifie un prix au-delà du seuil défini.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Power className="h-4 w-4 text-muted-foreground" />
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <Badge variant={enabled ? "default" : "secondary"}>
              {enabled ? "Activé" : "Désactivé"}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Seuil global */}
        <div className="space-y-2">
          <Label htmlFor="global-threshold">Seuil global de variation (%)</Label>
          <div className="flex items-center gap-2 max-w-xs">
            <Input
              id="global-threshold"
              type="number"
              min={1}
              max={100}
              step={1}
              value={globalThreshold}
              onChange={(e) => setGlobalThreshold(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">
              Alerte si variation ≥ {globalThreshold}%
            </span>
          </div>
        </div>

        {/* Surcharges par catégorie */}
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
                    min={1}
                    max={100}
                    step={1}
                    value={override.threshold}
                    onChange={(e) => updateCategoryThreshold(index, Number(e.target.value))}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
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
            <Button
              size="sm"
              variant="outline"
              onClick={addCategory}
              disabled={!selectedCategoryId}
            >
              <Plus className="h-4 w-4 mr-1" />
              Ajouter
            </Button>
          </div>

          {categoryOverrides.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Aucune surcharge. Toutes les catégories utilisent le seuil global ({globalThreshold}%).
            </p>
          )}
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
