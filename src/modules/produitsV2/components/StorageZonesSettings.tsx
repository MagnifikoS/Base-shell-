/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STORAGE ZONES — Settings Dialog
 * ═══════════════════════════════════════════════════════════════════════════
 * SSOT: table storage_zones (establishment-scoped)
 * Aucune saisie libre dans la fiche produit — uniquement les zones définies ici.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Pencil, Check, X, MapPin } from "lucide-react";
import { useStorageZones } from "../hooks/useStorageZones";

export function StorageZonesSettings() {
  const { zones, isLoading, addZone, updateZone, deleteZone } = useStorageZones();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await addZone.mutateAsync(newName);
    setNewName("");
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editingName.trim()) return;
    await updateZone.mutateAsync({ id: editingId, name: editingName });
    setEditingId(null);
    setEditingName("");
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deleteZone.mutate(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <MapPin className="h-4 w-4 mr-2" />
            Zone de stockage
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Zones de stockage
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Définissez les zones de stockage de l'établissement. Ces zones seront disponibles dans
            chaque fiche produit.
          </p>

          {/* Add new zone */}
          <div className="flex gap-2">
            <Input
              placeholder="Nouvelle zone (ex: Chambre froide, Réserve sèche...)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button
              size="icon"
              onClick={handleAdd}
              disabled={!newName.trim() || addZone.isPending}
              aria-label="Ajouter une zone"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* List */}
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {isLoading && <p className="text-sm text-muted-foreground">Chargement...</p>}
            {!isLoading && zones.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Aucune zone définie. Ajoutez-en une ci-dessus.
              </p>
            )}
            {zones.map((zone) => (
              <div key={zone.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                {editingId === zone.id ? (
                  <>
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-8 flex-1"
                      autoFocus
                      aria-label="Nom de la zone de stockage"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={handleSaveEdit}
                      aria-label="Valider la modification"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setEditingId(null)}
                      aria-label="Annuler la modification"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-sm">{zone.name}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditingId(zone.id);
                        setEditingName(zone.name);
                      }}
                      aria-label="Modifier la zone"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setDeleteTarget({ id: zone.id, name: zone.name })}
                      disabled={deleteZone.isPending}
                      aria-label="Supprimer la zone"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver la zone « {deleteTarget?.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les produits assignés à cette zone ne seront plus associés à aucune zone.
              Cette action est réversible depuis les paramètres avancés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Archiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
