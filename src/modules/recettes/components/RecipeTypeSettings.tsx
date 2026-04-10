/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Paramètres : gestion des types de recettes
 * ═══════════════════════════════════════════════════════════════
 *
 * Drag & drop reordering + icon picker for each recipe type.
 */

import { useState, useRef, useCallback } from "react";
import { useRecipeTypes } from "@/modules/recettes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, GripVertical } from "lucide-react";
import {
  RECIPE_ICON_OPTIONS,
  getRecipeTypeIcon,
} from "../utils/recipeIcons";
import type { RecipeType } from "../types";

export function RecipeTypeSettings() {
  const { recipeTypes, createType, updateType, deleteType, reorderTypes } = useRecipeTypes();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selectedIcon, setSelectedIcon] = useState("chef-hat");

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [localOrder, setLocalOrder] = useState<RecipeType[] | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  const displayTypes = localOrder ?? recipeTypes;

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setSelectedIcon("chef-hat");
    setDialogOpen(true);
  };

  const openEdit = (id: string, currentName: string, currentIcon: string) => {
    setEditingId(id);
    setName(currentName);
    setSelectedIcon(currentIcon || "chef-hat");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    if (editingId) {
      await updateType.mutateAsync({ id: editingId, name, icon: selectedIcon });
    } else {
      await createType.mutateAsync({ name, icon: selectedIcon });
    }
    setDialogOpen(false);
  };

  const handleDelete = async (id: string) => {
    await deleteType.mutateAsync(id);
  };

  // ── Drag handlers ──
  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDragIndex(index);
    dragNodeRef.current = e.currentTarget;
    e.dataTransfer.effectAllowed = "move";
    // Make the drag image slightly transparent
    requestAnimationFrame(() => {
      if (dragNodeRef.current) {
        dragNodeRef.current.style.opacity = "0.4";
      }
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragNodeRef.current) {
      dragNodeRef.current.style.opacity = "1";
    }
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      const reordered = [...displayTypes];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(overIndex, 0, moved);
      setLocalOrder(reordered);
      reorderTypes.mutate(
        reordered.map((t) => t.id),
        { onSettled: () => setLocalOrder(null) }
      );
    }
    setDragIndex(null);
    setOverIndex(null);
    dragNodeRef.current = null;
  }, [dragIndex, overIndex, displayTypes, reorderTypes]);

  // ── Touch drag (mobile) ──
  const touchState = useRef<{
    index: number;
    startY: number;
    currentY: number;
    clone: HTMLDivElement | null;
    itemHeight: number;
  } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>, index: number) => {
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    touchState.current = {
      index,
      startY: touch.clientY,
      currentY: touch.clientY,
      clone: null,
      itemHeight: rect.height + 8, // include gap
    };
    setDragIndex(index);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchState.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    touchState.current.currentY = touch.clientY;
    const delta = touch.clientY - touchState.current.startY;
    const indexShift = Math.round(delta / touchState.current.itemHeight);
    const newOver = Math.max(0, Math.min(displayTypes.length - 1, touchState.current.index + indexShift));
    setOverIndex(newOver);
  }, [displayTypes.length]);

  const handleTouchEnd = useCallback(() => {
    if (touchState.current && dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      const reordered = [...displayTypes];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(overIndex, 0, moved);
      setLocalOrder(reordered);
      reorderTypes.mutate(
        reordered.map((t) => t.id),
        { onSettled: () => setLocalOrder(null) }
      );
    }
    touchState.current = null;
    setDragIndex(null);
    setOverIndex(null);
  }, [dragIndex, overIndex, displayTypes, reorderTypes]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Types de recettes
          </h2>
          <p className="text-sm text-muted-foreground">
            Organisez vos recettes par type
          </p>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5 min-h-[36px]">
          <Plus className="w-4 h-4" />
          Ajouter
        </Button>
      </div>

      {displayTypes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Aucun type défini. Créez votre premier type de recette.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayTypes.map((t, index) => {
            const Icon = getRecipeTypeIcon(t.icon);
            const isDragging = dragIndex === index;
            const isOver = overIndex === index && dragIndex !== index;
            return (
              <div
                key={t.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onTouchStart={(e) => handleTouchStart(e, index)}
                onTouchMove={(e) => handleTouchMove(e)}
                onTouchEnd={handleTouchEnd}
                className={`
                  flex items-center justify-between rounded-xl border bg-card px-3 min-h-[56px]
                  transition-all duration-200 select-none
                  ${isDragging ? "opacity-40 scale-[0.98]" : ""}
                  ${isOver ? "border-primary/50 bg-primary/5 shadow-sm" : "border-border/60"}
                `}
              >
                <div className="flex items-center gap-2.5">
                  <div className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                    <GripVertical className="w-4 h-4" />
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <span className="font-medium text-foreground">{t.name}</span>
                </div>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => openEdit(t.id, t.name, t.icon)}
                    aria-label="Modifier"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(t.id)}
                    aria-label="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Modifier le type" : "Nouveau type de recette"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-2">
            <Input
              placeholder="Ex : Sauces, Plats, Desserts…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="h-11"
              autoFocus
            />

            {/* Icon picker */}
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block">
                Icône
              </label>
              <div className="grid grid-cols-5 gap-2">
                {RECIPE_ICON_OPTIONS.map((opt) => {
                  const OptIcon = opt.icon;
                  const isSelected = selectedIcon === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setSelectedIcon(opt.key)}
                      title={opt.label}
                      className={`
                        flex flex-col items-center justify-center gap-1 rounded-xl p-2.5
                        transition-all active:scale-95
                        ${
                          isSelected
                            ? "bg-primary/10 ring-2 ring-primary text-primary"
                            : "bg-muted/50 text-muted-foreground hover:bg-muted"
                        }
                      `}
                    >
                      <OptIcon className="w-5 h-5" />
                      <span className="text-[10px] leading-tight truncate w-full text-center">
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Button
              className="w-full min-h-[44px]"
              onClick={handleSave}
              disabled={
                !name.trim() ||
                createType.isPending ||
                updateType.isPending
              }
            >
              {editingId ? "Enregistrer" : "Créer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
