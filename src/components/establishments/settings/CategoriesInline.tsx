/**
 * CategoriesInline
 *
 * Full CRUD categories editor for the Settings hub.
 * SSOT = product_categories table (same as useProductCategories hook).
 * Archive/restore instead of delete. Toggle to show archived.
 */

import { useState } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Check, X, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { useCategoriesSettings } from "@/hooks/useCategoriesSettings";

export function CategoriesInline() {
  const [showArchived, setShowArchived] = useState(false);
  const {
    activeCategories,
    archivedCategories,
    isLoading,
    createCategory,
    renameCategory,
    archiveCategory,
    restoreCategory,
  } = useCategoriesSettings(showArchived);

  // Add dialog
  const [newName, setNewName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Archive confirm
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const ok = await createCategory(trimmed);
    if (ok) {
      setNewName("");
      setIsAdding(false);
    }
  };

  const handleRename = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    const ok = await renameCategory(id, trimmed);
    if (ok) setEditingId(null);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ces catégories seront disponibles dans chaque fiche produit pour classer les articles.
      </p>

      {/* Add + toggle archived */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {isAdding ? (
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nom de la catégorie"
              className="h-8 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") setIsAdding(false);
              }}
            />
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleAdd}>
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => setIsAdding(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAdding(true)}
            className="h-8 text-xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Ajouter une catégorie
          </Button>
        )}

        <div className="flex items-center gap-2">
          <Switch
            id="show-archived-cats"
            checked={showArchived}
            onCheckedChange={setShowArchived}
          />
          <Label
            htmlFor="show-archived-cats"
            className="text-sm text-muted-foreground cursor-pointer"
          >
            Afficher catégories archivées
          </Label>
        </div>
      </div>

      {/* Active categories list */}
      <div className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Chargement...</p>}
        {!isLoading && activeCategories.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Aucune catégorie définie. Ajoutez-en une ci-dessus.
          </p>
        )}
        {activeCategories.map((cat) => (
          <div key={cat.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
            {editingId === cat.id ? (
              <>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-7 text-sm flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(cat.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => handleRename(cat.id)}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => setEditingId(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1">{cat.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    setEditingId(cat.id);
                    setEditName(cat.name);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  onClick={() => setArchiveTarget(cat)}
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Archived categories */}
      {showArchived && archivedCategories.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Catégories archivées ({archivedCategories.length})
          </p>
          {archivedCategories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 opacity-60"
            >
              <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm flex-1 line-through">{cat.name}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => restoreCategory(cat.id)}
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Archive confirmation dialog */}
      <AlertDialog open={!!archiveTarget} onOpenChange={() => setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver la catégorie ?</AlertDialogTitle>
            <AlertDialogDescription>
              La catégorie « {archiveTarget?.name} » ne sera plus proposée lors de la création de
              produits. Les produits existants ne sont pas modifiés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiveTarget) archiveCategory(archiveTarget.id);
                setArchiveTarget(null);
              }}
            >
              Archiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
