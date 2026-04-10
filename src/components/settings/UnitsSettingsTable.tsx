/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 2 — Unités : compact card list filtered by clickable chips
 * No search bar, no dropdown — chips in GuideBlock handle filtering
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ShieldAlert, MoreHorizontal, EyeOff, Eye } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  useMeasurementUnits,
  checkUnitUsage,
  type MeasurementUnit,
  type UnitUsageReport,
} from "@/modules/visionAI";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { DeleteGuardDialog } from "./DeleteGuardDialog";

const USAGE_LABELS: Record<string, string> = {
  supplier: "Fournisseur",
  stock: "Stock",
  recipe: "Cuisine",
  reference: "Référence",
};

const _USAGE_BADGE: Record<string, string> = {
  supplier:
    "bg-blue-100 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  stock:
    "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  recipe:
    "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800",
  reference:
    "bg-purple-100 dark:bg-purple-950/30 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800",
};

interface UnitFormData {
  name: string;
  abbreviation: string;
  aliases: string;
  usage_category: string;
  family: string;
  notes: string;
  is_active: boolean;
}

const EMPTY_FORM: UnitFormData = {
  name: "",
  abbreviation: "",
  aliases: "",
  usage_category: "supplier",
  family: "",
  notes: "",
  is_active: true,
};

interface Props {
  activeFilter: string | null;
}

export function UnitsSettingsTable({ activeFilter }: Props) {
  const { units, isLoading, create, remove, toggleActive, isCreating, isUpdating, isDeleting } =
    useMeasurementUnits();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<MeasurementUnit | null>(null);
  const [editLocked, setEditLocked] = useState(false);
  const [form, setForm] = useState<UnitFormData>(EMPTY_FORM);

  const [deleteTarget, setDeleteTarget] = useState<MeasurementUnit | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deletingOptionB, setDeletingOptionB] = useState(false);
  const [usageReport, setUsageReport] = useState<UnitUsageReport | null>(null);
  const [productSearch, setProductSearch] = useState("");

  const filteredUnits = useMemo(() => {
    if (!activeFilter) return units;
    return units.filter((u) => (u.usage_category || "supplier") === activeFilter);
  }, [units, activeFilter]);

  const filteredProducts = useMemo(() => {
    if (!usageReport) return [];
    const q = productSearch.toLowerCase().trim();
    if (!q) return usageReport.sampleProducts;
    return usageReport.sampleProducts.filter((n) => n.toLowerCase().includes(q));
  }, [usageReport, productSearch]);

  const openCreate = () => {
    setEditingUnit(null);
    setEditLocked(false);
    setForm({ ...EMPTY_FORM, usage_category: activeFilter || "supplier" });
    setFormOpen(true);
  };

  const openEdit = useCallback(async (unit: MeasurementUnit) => {
    setEditingUnit(unit);
    setForm({
      name: unit.name,
      abbreviation: unit.abbreviation,
      aliases: (unit.aliases || []).join(", "),
      usage_category: unit.usage_category || "supplier",
      family: unit.family || "",
      notes: unit.notes || "",
      is_active: unit.is_active,
    });
    const report = await checkUnitUsage(unit.id);
    setEditLocked(report.isUsed);
    setFormOpen(true);
  }, []);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const aliases = form.aliases
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    if (editingUnit) {
      const updateData: Record<string, unknown> = {
        is_active: form.is_active,
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (!editLocked) {
        updateData.name = form.name.trim();
        updateData.abbreviation = form.abbreviation.trim() || form.name.trim();
        updateData.aliases = aliases;
        updateData.usage_category = form.usage_category;
        updateData.family = form.family || null;
      }
      const { error } = await supabase
        .from("measurement_units")
        .update(updateData)
        .eq("id", editingUnit.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Unité modifiée");
      queryClient.invalidateQueries({ queryKey: ["measurement-units"] });
      queryClient.invalidateQueries({ queryKey: ["units"] });
    } else {
      await create({
        name: form.name.trim(),
        abbreviation: form.abbreviation.trim() || form.name.trim(),
        aliases: form.aliases,
        is_active: form.is_active,
      });
    }
    setFormOpen(false);
  };

  const handleDeleteClick = async (unit: MeasurementUnit) => {
    setDeleteTarget(unit);
    setDeleteLoading(true);
    setUsageReport(null);
    setProductSearch("");
    const report = await checkUnitUsage(unit.id);
    setUsageReport(report);
    setDeleteLoading(false);
  };

  const confirmDeleteSimple = async () => {
    if (!deleteTarget || usageReport?.isUsed) return;
    try {
      await remove(deleteTarget.id);
      closeDeleteDialog();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmOptionB = async () => {
    if (!deleteTarget) return;
    setDeletingOptionB(true);
    const { executeOptionBDeletion } = await import("@/modules/visionAI");
    const result = await executeOptionBDeletion(deleteTarget.id);
    setDeletingOptionB(false);
    if (result.success) {
      toast.success(
        `Unité supprimée. ${result.productsReset} produit(s) réinitialisé(s), ` +
          `${result.conversionsDeleted} conversion(s) et ${result.packagingDeleted} format(s) supprimés.`
      );
      queryClient.invalidateQueries({ queryKey: ["measurement-units"] });
      queryClient.invalidateQueries({ queryKey: ["units"] });
      closeDeleteDialog();
    } else {
      toast.error(result.error || "Erreur lors de la suppression");
    }
  };

  const handleDeactivate = async () => {
    if (!deleteTarget) return;
    await toggleActive({ id: deleteTarget.id, is_active: false });
    toast.success("Unité désactivée");
    closeDeleteDialog();
  };

  const closeDeleteDialog = () => {
    setDeleteTarget(null);
    setUsageReport(null);
    setProductSearch("");
  };

  if (isLoading) {
    return <div className="text-muted-foreground text-sm py-4">Chargement…</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Unités de mesure
          {activeFilter && (
            <span className="text-muted-foreground font-normal">
              {" "}
              — {USAGE_LABELS[activeFilter]}
            </span>
          )}
        </h3>
        <Button size="sm" variant="outline" onClick={openCreate} className="h-8 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" /> Ajouter
        </Button>
      </div>

      {filteredUnits.length === 0 ? (
        <p className="text-center text-muted-foreground text-xs py-6">
          {activeFilter ? "Aucune unité dans cette catégorie" : "Aucune unité"}
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
          {filteredUnits.map((unit) => (
            <div
              key={unit.id}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border bg-card hover:bg-muted/30 transition-colors group",
                !unit.is_active && "opacity-40"
              )}
            >
              <div
                className={cn(
                  "h-2 w-2 rounded-full flex-shrink-0",
                  unit.is_active ? "bg-emerald-500 dark:bg-emerald-600" : "bg-muted-foreground/30"
                )}
              />

              <span className="text-sm font-medium truncate flex-1">
                {unit.name}
                {unit.abbreviation && unit.abbreviation !== unit.name && (
                  <span className="text-muted-foreground font-normal"> ({unit.abbreviation})</span>
                )}
              </span>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    aria-label="Plus d'actions"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => openEdit(unit)}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => toggleActive({ id: unit.id, is_active: !unit.is_active })}
                  >
                    {unit.is_active ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5 mr-2" /> Désactiver
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5 mr-2" /> Activer
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => handleDeleteClick(unit)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUnit ? "Modifier l'unité" : "Ajouter une unité"}</DialogTitle>
            <DialogDescription>
              {editLocked
                ? "⚠️ Cette unité est utilisée — seules les notes et l'activation sont modifiables."
                : editingUnit
                  ? "Modifiez les propriétés de l'unité."
                  : "Créez une nouvelle unité de mesure."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editLocked && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm">
                <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                Champs structurants verrouillés
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nom *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="ex : Barquette"
                  disabled={editLocked}
                />
              </div>
              <div className="space-y-2">
                <Label>Abréviation</Label>
                <Input
                  value={form.abbreviation}
                  onChange={(e) => setForm({ ...form, abbreviation: e.target.value })}
                  placeholder="ex : barq"
                  disabled={editLocked}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Alias (séparés par virgule)</Label>
              <Input
                value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                placeholder="ex : bqt, barq"
                disabled={editLocked}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Rôle</Label>
                <Select
                  value={form.usage_category}
                  onValueChange={(v) => setForm({ ...form, usage_category: v })}
                  disabled={editLocked}
                >
                  <SelectTrigger aria-label="Rôle de l'unité">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="supplier">Fournisseur</SelectItem>
                    <SelectItem value="stock">Stock</SelectItem>
                    <SelectItem value="recipe">Cuisine</SelectItem>
                    <SelectItem value="reference">Référence</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Famille</Label>
                <Select
                  value={form.family}
                  onValueChange={(v) => setForm({ ...form, family: v })}
                  disabled={editLocked}
                >
                  <SelectTrigger aria-label="Famille de l'unité">
                    <SelectValue placeholder="--" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weight">Poids</SelectItem>
                    <SelectItem value="volume">Volume</SelectItem>
                    <SelectItem value="count">Comptage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Remarques</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Notes libres…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || isCreating || isUpdating}>
              {editingUnit ? "Enregistrer" : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteGuardDialog
        target={deleteTarget}
        loading={deleteLoading}
        deletingOptionB={deletingOptionB}
        usageReport={usageReport}
        productSearch={productSearch}
        filteredProducts={filteredProducts}
        onProductSearchChange={setProductSearch}
        onClose={closeDeleteDialog}
        onDeleteSimple={confirmDeleteSimple}
        onDeactivate={handleDeactivate}
        onOptionB={confirmOptionB}
        isDeleting={isDeleting}
      />
    </div>
  );
}
