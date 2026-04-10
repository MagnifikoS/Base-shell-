/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PackagingSection — compact card list for packaging formats
 * Replaces old PackagingTable with toggles
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Pencil, Trash2, MoreHorizontal, EyeOff, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  usePackagingFormats,
  useMeasurementUnits,
  type PackagingFormat,
  type PackagingFormatFormData,
} from "@/modules/visionAI";
import { packagingFormatSchema } from "@/lib/schemas/settings";

export function PackagingSection() {
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
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const getUnitLabel = (unitId: string) => {
    const u = units.find((x) => x.id === unitId);
    return u ? `${u.name} (${u.abbreviation})` : "—";
  };

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
    setFormErrors({});
    const result = packagingFormatSchema.safeParse(form);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path.join(".");
        if (!errors[field]) errors[field] = issue.message;
      });
      setFormErrors(errors);
      return;
    }
    if (editingFormat) await update({ id: editingFormat.id, formData: form });
    else await create(form);
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
      setDeleteBlocked(err instanceof Error ? err.message : String(err));
    }
  };

  if (isLoading) return <div className="text-muted-foreground text-sm py-4">Chargement…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Formats de saisie</h3>
          <p className="text-[11px] text-muted-foreground">Raccourcis pour pré-remplir le Wizard</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={openCreate}
          disabled={activeUnits.length === 0}
          className="h-8 text-xs"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Ajouter
        </Button>
      </div>

      {formats.length === 0 ? (
        <p className="text-center text-muted-foreground text-xs py-6">Aucun format</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
          {formats.map((fmt) => (
            <div
              key={fmt.id}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border bg-card hover:bg-muted/30 transition-colors group",
                !fmt.is_active && "opacity-40"
              )}
            >
              <div
                className={cn(
                  "h-2 w-2 rounded-full flex-shrink-0",
                  fmt.is_active ? "bg-emerald-500 dark:bg-emerald-600" : "bg-muted-foreground/30"
                )}
              />

              <span className="text-sm font-medium truncate flex-1">{fmt.label}</span>

              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                {fmt.quantity} × {getUnitLabel(fmt.unit_id)}
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
                  <DropdownMenuItem onClick={() => openEdit(fmt)}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => toggleActive({ id: fmt.id, is_active: !fmt.is_active })}
                  >
                    {fmt.is_active ? (
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
                    onClick={() => handleDelete(fmt)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setFormErrors({});
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFormat ? "Modifier le format" : "Ajouter un format"}</DialogTitle>
            <DialogDescription>
              {editingFormat
                ? "Modifiez le format de saisie."
                : "Créez un raccourci pour le Wizard."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Libellé *</Label>
              <Input
                value={form.label}
                onChange={(e) => {
                  setForm({ ...form, label: e.target.value });
                  setFormErrors((prev) => {
                    const n = { ...prev };
                    delete n.label;
                    return n;
                  });
                }}
                placeholder="ex : Carton de 6"
                className={formErrors.label ? "border-destructive" : ""}
              />
              {formErrors.label && (
                <p className="text-sm text-destructive mt-1">{formErrors.label}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Unité contenue *</Label>
                <Select
                  value={form.unit_id}
                  onValueChange={(v) => {
                    setForm({ ...form, unit_id: v });
                    setFormErrors((prev) => {
                      const n = { ...prev };
                      delete n.unit_id;
                      return n;
                    });
                  }}
                >
                  <SelectTrigger
                    aria-label="Unité contenue"
                    className={formErrors.unit_id ? "border-destructive" : ""}
                  >
                    <SelectValue placeholder="Choisir..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.abbreviation})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formErrors.unit_id && (
                  <p className="text-sm text-destructive mt-1">{formErrors.unit_id}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Quantité</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => {
                    setForm({ ...form, quantity: Number(e.target.value) || 1 });
                    setFormErrors((prev) => {
                      const n = { ...prev };
                      delete n.quantity;
                      return n;
                    });
                  }}
                  className={formErrors.quantity ? "border-destructive" : ""}
                />
                {formErrors.quantity && (
                  <p className="text-sm text-destructive mt-1">{formErrors.quantity}</p>
                )}
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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {deleteTarget?.label} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBlocked ||
                "Ce format sera supprimé. Les conditionnements existants ne seront pas affectés."}
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
