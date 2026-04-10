import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useMeasurementUnits } from "../hooks/useMeasurementUnits";
import type { MeasurementUnit, MeasurementUnitFormData } from "../types";

const EMPTY_FORM: MeasurementUnitFormData = {
  name: "",
  abbreviation: "",
  aliases: "",
  is_active: true,
};

export function UnitsTable() {
  const {
    units,
    isLoading,
    create,
    update,
    remove,
    toggleActive,
    isCreating,
    isUpdating,
    isDeleting,
  } = useMeasurementUnits();

  const [formOpen, setFormOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<MeasurementUnit | null>(null);
  const [form, setForm] = useState<MeasurementUnitFormData>(EMPTY_FORM);

  const [deleteTarget, setDeleteTarget] = useState<MeasurementUnit | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);

  const openCreate = () => {
    setEditingUnit(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (unit: MeasurementUnit) => {
    setEditingUnit(unit);
    setForm({
      name: unit.name,
      abbreviation: unit.abbreviation,
      aliases: (unit.aliases || []).join(", "),
      is_active: unit.is_active,
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editingUnit) {
      await update({ id: editingUnit.id, formData: form });
    } else {
      await create(form);
    }
    setFormOpen(false);
  };

  const handleDelete = (unit: MeasurementUnit) => {
    setDeleteBlocked(null);
    setDeleteTarget(unit);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err: unknown) {
      setDeleteBlocked(err instanceof Error ? err.message : "Erreur lors de la suppression");
    }
  };

  if (isLoading) {
    return <div className="text-muted-foreground text-sm py-4">Chargement...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Unités de mesure</h3>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Ajouter
        </Button>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Actif</TableHead>
              <TableHead>Nom</TableHead>
              <TableHead>Abréviation</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Aucune unité
                </TableCell>
              </TableRow>
            ) : (
              units.map((unit) => (
                <TableRow key={unit.id}>
                  <TableCell>
                    <Switch
                      checked={unit.is_active}
                      onCheckedChange={() =>
                        toggleActive({ id: unit.id, is_active: !unit.is_active })
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">{unit.name}</TableCell>
                  <TableCell className="text-muted-foreground">{unit.abbreviation}</TableCell>
                  <TableCell className="text-muted-foreground capitalize">
                    {unit.category}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(unit)}
                        aria-label="Modifier l'unité"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(unit)}
                        aria-label="Supprimer l'unité"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUnit ? "Modifier l'unité" : "Ajouter une unité"}</DialogTitle>
            <DialogDescription>
              {editingUnit
                ? "Modifiez le libellé ou l'abréviation."
                : "Créez une nouvelle unité de mesure."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nom *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="ex : Barquette"
              />
            </div>
            <div className="space-y-2">
              <Label>Abréviation</Label>
              <Input
                value={form.abbreviation}
                onChange={(e) => setForm({ ...form, abbreviation: e.target.value })}
                placeholder="ex : barq"
              />
            </div>
            <div className="space-y-2">
              <Label>Alias (séparés par virgule)</Label>
              <Input
                value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                placeholder="ex : bqt, barq"
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

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {deleteTarget?.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBlocked
                ? deleteBlocked
                : "Cette action est irréversible. L'unité sera supprimée si elle n'est utilisée par aucun produit ou conditionnement."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            {!deleteBlocked && (
              <AlertDialogAction
                onClick={confirmDelete}
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Supprimer
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
