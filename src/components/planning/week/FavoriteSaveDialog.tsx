/**
 * FavoriteSaveDialog — Dialog for saving a named planning favorite.
 *
 * - Input for favorite name
 * - If 2 favorites already exist, shows radio buttons to pick which to replace
 * - Buttons: [Annuler] [Enregistrer]
 */
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Star } from "lucide-react";
import type { NamedFavorite } from "../hooks/usePlanningFavorites";
import { MAX_FAVORITES_PER_EMPLOYEE } from "../hooks/usePlanningFavorites";

interface FavoriteSaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  employeeName: string;
  existingFavorites: NamedFavorite[];
  /** Called when saving a new favorite (slot available) */
  onSave: (name: string) => void;
  /** Called when replacing an existing favorite */
  onReplace: (index: number, name: string) => void;
}

export function FavoriteSaveDialog({
  isOpen,
  onClose,
  employeeName,
  existingFavorites,
  onSave,
  onReplace,
}: FavoriteSaveDialogProps) {
  const [name, setName] = useState("");
  const [replaceIndex, setReplaceIndex] = useState<string>("0");

  const needsReplace = existingFavorites.length >= MAX_FAVORITES_PER_EMPLOYEE;

  // Reset form state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setReplaceIndex("0");
    }
  }, [isOpen]);

  const handleSubmit = () => {
    const trimmedName = name.trim() || "Favori";

    if (needsReplace) {
      onReplace(parseInt(replaceIndex, 10), trimmedName);
    } else {
      onSave(trimmedName);
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
            Enregistrer un favori
          </DialogTitle>
          <DialogDescription>
            Enregistrer le planning actuel de {employeeName} comme favori.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name input */}
          <div className="space-y-2">
            <Label htmlFor="favorite-name">Nom du favori</Label>
            <Input
              id="favorite-name"
              placeholder="Ex: Semaine normale"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>

          {/* Replace selection when 2 favorites already exist */}
          {needsReplace && (
            <div className="space-y-2">
              <Label className="text-amber-600">
                Maximum {MAX_FAVORITES_PER_EMPLOYEE} favoris atteint. Choisissez lequel remplacer :
              </Label>
              <RadioGroup value={replaceIndex} onValueChange={setReplaceIndex}>
                {existingFavorites.map((fav, i) => (
                  <div key={i} className="flex items-center space-x-2">
                    <RadioGroupItem value={String(i)} id={`fav-replace-${i}`} />
                    <Label htmlFor={`fav-replace-${i}`} className="cursor-pointer">
                      {fav.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({fav.shifts.length} shift{fav.shifts.length > 1 ? "s" : ""})
                      </span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={handleSubmit}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
