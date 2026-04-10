/**
 * StorageZonesInline
 *
 * Full CRUD storage zones editor for the Settings hub.
 * Archive/restore instead of delete. Toggle to show archived zones.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  Plus,
  Pencil,
  Check,
  X,
  MapPin,
  Archive,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { useStorageZonesSettings } from "@/hooks/useStorageZonesSettings";
import type { StorageZoneSettings } from "@/hooks/useStorageZonesSettings";

export function StorageZonesInline() {
  const [showArchived, setShowArchived] = useState(false);
  const {
    activeZones,
    archivedZones,
    isLoading,
    createZone,
    updateZone,
    archiveZone,
    restoreZone,
  } = useStorageZonesSettings(showArchived);

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCode, setAddCode] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingCode, setEditingCode] = useState("");

  // Archive confirm
  const [archiveTarget, setArchiveTarget] = useState<StorageZoneSettings | null>(null);

  const handleAdd = async () => {
    if (!addName.trim()) return;
    await createZone.mutateAsync({ name: addName, code: addCode });
    setAddName("");
    setAddCode("");
    setAddOpen(false);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editingName.trim()) return;
    await updateZone.mutateAsync({ id: editingId, name: editingName, code: editingCode });
    setEditingId(null);
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    await archiveZone.mutateAsync(archiveTarget.id);
    setArchiveTarget(null);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ces zones seront disponibles dans chaque fiche produit pour indiquer l'emplacement de
        stockage.
      </p>

      {/* Header actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Ajouter une zone
        </Button>
        <div className="flex items-center gap-2">
          <Switch
            id="show-archived"
            checked={showArchived}
            onCheckedChange={setShowArchived}
          />
          <Label htmlFor="show-archived" className="text-sm text-muted-foreground cursor-pointer">
            Afficher zones archivées
          </Label>
        </div>
      </div>

      {/* Active zones list */}
      <div className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Chargement...</p>}
        {!isLoading && activeZones.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Aucune zone définie. Ajoutez-en une ci-dessus.
          </p>
        )}
        {activeZones.map((zone) => (
          <div key={zone.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
            {editingId === zone.id ? (
              <>
                <div className="flex-1 flex gap-2">
                  <Input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="h-8 flex-1"
                    placeholder="Nom"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <Input
                    value={editingCode}
                    onChange={(e) => setEditingCode(e.target.value)}
                    className="h-8 w-24"
                    placeholder="Code"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={handleSaveEdit}
                  aria-label="Valider"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => setEditingId(null)}
                  aria-label="Annuler"
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm font-medium">{zone.name}</span>
                {zone.code && (
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {zone.code}
                  </span>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => {
                    setEditingId(zone.id);
                    setEditingName(zone.name);
                    setEditingCode(zone.code ?? "");
                  }}
                  aria-label="Renommer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive"
                  onClick={() => setArchiveTarget(zone)}
                  aria-label="Archiver"
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Archived zones */}
      {showArchived && archivedZones.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Zones archivées ({archivedZones.length})
          </p>
          {archivedZones.map((zone) => (
            <div
              key={zone.id}
              className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 opacity-60"
            >
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-sm line-through">{zone.name}</span>
              {zone.code && (
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {zone.code}
                </span>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-primary"
                onClick={() => restoreZone.mutate(zone.id)}
                disabled={restoreZone.isPending}
                aria-label="Réactiver"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add zone dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter une zone de stockage</DialogTitle>
            <DialogDescription>
              Définissez le nom et un code optionnel pour cette zone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="zone-name">Nom *</Label>
              <Input
                id="zone-name"
                placeholder="Ex: Chambre froide, Réserve sèche..."
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="zone-code">Code (optionnel)</Label>
              <Input
                id="zone-code"
                placeholder="Ex: CF, RS..."
                value={addCode}
                onChange={(e) => setAddCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleAdd} disabled={!addName.trim() || createZone.isPending}>
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation */}
      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Archiver « {archiveTarget?.name} » ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cette zone ne sera plus proposée lors de la création ou modification de produits.
              Les produits déjà associés à cette zone conserveront leur historique.
              Vous pourrez la réactiver à tout moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>
              Archiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
