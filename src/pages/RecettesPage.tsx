/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Page principale
 * ═══════════════════════════════════════════════════════════════
 *
 * Search bar + type filter chips + recipe list.
 * Same layout pattern as Food Cost for consistency.
 */

import { useState } from "react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { Button } from "@/components/ui/button";
import { Settings, BookOpen, Plus, ArrowLeft } from "lucide-react";
import { useRecipeTypes } from "@/modules/recettes";
import { RecipeListView } from "@/modules/recettes/components/RecipeListView";
import { RecipeTypeSettings } from "@/modules/recettes/components/RecipeTypeSettings";
import { RecipeWizard } from "@/modules/recettes/components/RecipeWizard";
import { RecipeSearchBar } from "@/modules/foodCost/components/RecipeSearchBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function RecettesPage() {
  const { recipeTypes, isLoading: typesLoading } = useRecipeTypes();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // ── Settings view ──
  if (showSettings) {
    return (
      <ResponsiveLayout>
        <div className="container max-w-2xl py-6 px-4 space-y-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setShowSettings(false)}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Paramètres</h1>
              <p className="text-sm text-muted-foreground">
                Gestion des types de recettes
              </p>
            </div>
          </div>
          <RecipeTypeSettings />
        </div>
      </ResponsiveLayout>
    );
  }

  return (
    <ResponsiveLayout>
      <div className="container max-w-2xl py-6 px-4 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Recettes</h1>
              <p className="text-xs text-muted-foreground">Fiches techniques</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setShowSettings(true)}
              aria-label="Paramètres"
            >
              <Settings className="w-5 h-5" />
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setWizardOpen(true)}>
              <Plus className="w-4 h-4" />
              Créer
            </Button>
          </div>
        </div>

        {/* Search */}
        <RecipeSearchBar value={search} onChange={setSearch} />

        {/* Type filter dropdown */}
        {recipeTypes.length > 0 && (
          <Select
            value={selectedTypeId ?? "all"}
            onValueChange={(v) => setSelectedTypeId(v === "all" ? null : v)}
          >
            <SelectTrigger className="w-full h-10 rounded-xl bg-card border-border/60">
              <SelectValue placeholder="Filtrer par type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {recipeTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Recipe list */}
        <RecipeListView
          filterTypeId={selectedTypeId}
          searchQuery={search}
          isLoading={typesLoading}
        />
      </div>

      <RecipeWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </ResponsiveLayout>
  );
}
