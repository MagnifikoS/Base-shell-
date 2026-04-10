/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 3 — Formats de saisie (raccourcis Wizard)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * packaging_formats = uniquement UI shortcut pour pré-remplir un niveau
 * de conditionnement dans le Wizard V3.
 * Ce n'est PAS une source d'unités.
 */

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { usePackagingFormats } from "../hooks/usePackagingFormats";
import { useMeasurementUnits } from "../hooks/useMeasurementUnits";
import type { PackagingFormat, PackagingFormatFormData } from "../types";

export function PackagingTable() {
  const {
    formats,
    isLoading,
    create,
    update,
    remove,
    toggleActive,
    isCreating,
    isUpdating,
    isDeleting,
  } = usePackagingFormats();
  const { units } = useMeasurementUnits();

  const activeUnits = units.filter((u) => u.is_active);

  const getDefaultUnitId = () =>
    activeUnits.find((u) => u.abbreviation === "pce")?.id || activeUnits[0]?.id || "";

  const emptyForm = (): PackagingFormatFormData => ({
    label: "",
    unit_id: getDefaultUnitId(),
    quantity: 1,
    is_active: true,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editingFormat, setEditingFormat] = useState<PackagingFormat | null>(null);
  const [form, setForm] = useState<PackagingFormatFormData>(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<PackagingFormat | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);

  const getUnitName = (unitId: string) => units.find((u) => u.id === unitId)?.name || "—";

  const openCreate = () => {
    if (activeUnits.length === 0) return;
    setEditingFormat(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (fmt: PackagingFormat) => {
    setEditingFormat(fmt);
    setForm({
      label: fmt.label,
      unit_id: fmt.unit_id,
      quantity: fmt.quantity,
      is_active: fmt.is_active,
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.label.trim() || !form.unit_id) return;
    if (editingFormat) {
      await update({ id: editingFormat.id, formData: form });
    } else {
      await create(form);
    }
    setFormOpen(false);
  };

  const handleDelete = (fmt: PackagingFormat) => {
    setDeleteBlocked(null);
    setDeleteTarget(fmt);
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
    return <div className="text-muted-foreground text-sm py-4">Chargement…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Formats de saisie (raccourcis Wizard)</h3>
          <Button size="sm" onClick={openCreate} disabled={activeUnits.length === 0}>
            <Plus className="h-4 w-4 mr-1" /> Ajouter
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Un format n'est pas une unité. Il sert uniquement à pré-remplir un niveau de
          conditionnement dans le Wizard.
        </p>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Actif</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead>Unité contenue</TableHead>
              <TableHead>Quantité</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {formats.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                  Aucun format de saisie
                </TableCell>
              </TableRow>
            ) : (
              formats.map((fmt) => (
                <TableRow key={fmt.id}>
                  <TableCell>
                    <Switch
                      checked={fmt.is_active}
                      onCheckedChange={() =>
                        toggleActive({ id: fmt.id, is_active: !fmt.is_active })
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">{fmt.label}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {getUnitName(fmt.unit_id)}
                  </TableCell>
                  <TableCell>{fmt.quantity}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(fmt)}
                        aria-label="Modifier le conditionnement"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(fmt)}
                        aria-label="Supprimer le conditionnement"
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
            <DialogTitle>{editingFormat ? "Modifier le format" : "Ajouter un format"}</DialogTitle>
            <DialogDescription>
              {editingFormat
                ? "Modifiez le format de saisie."
                : "Créez un raccourci de conditionnement pour le Wizard."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Libellé *</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="ex : Carton de 6"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Unité contenue *</Label>
                <Select
                  value={form.unit_id}
                  onValueChange={(v) => setForm({ ...form, unit_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.abbreviation})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quantité</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) || 1 })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.label.trim() || !form.unit_id || isCreating || isUpdating}
            >
              {editingFormat ? "Enregistrer" : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {deleteTarget?.label} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBlocked
                ? deleteBlocked
                : "Ce format de saisie sera supprimé. Les conditionnements produits existants ne seront pas affectés."}
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
