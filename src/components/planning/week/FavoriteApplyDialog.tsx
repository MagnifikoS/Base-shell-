/**
 * FavoriteApplyDialog — Dialog for applying saved favorites to the current week.
 *
 * Flow:
 * 1. Lists employees that have saved favorites
 * 2. Click employee -> shows their 1 or 2 favorites by name
 * 3. If 1 favorite -> "Appliquer ?" + [Annuler] [Valider]
 * 4. If 2 favorites -> radio selection, then [Annuler] [Valider]
 * 5. If shifts already exist -> confirmation: "Des shifts existent deja. Remplacer ?"
 * 6. On confirm -> apply favorite
 */
import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Star, ChevronLeft, Loader2 } from "lucide-react";
import type { NamedFavorite } from "../hooks/usePlanningFavorites";
import type { PlanningEmployee, PlanningShift } from "../types/planning.types";

interface EmployeeFavoriteEntry {
  employee: PlanningEmployee;
  favorites: NamedFavorite[];
}

interface FavoriteApplyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Employees with favorites and their favorite data */
  entries: EmployeeFavoriteEntry[];
  /** Check if employee already has shifts in the target week */
  getExistingShifts: (userId: string) => PlanningShift[];
  /** Apply a favorite for an employee (handles shift deletion + creation) */
  onApply: (userId: string, favoriteIndex: number) => void;
  /** Whether apply operation is in progress */
  isApplying: boolean;
}

type DialogStep = "list" | "select" | "confirm";

export function FavoriteApplyDialog({
  isOpen,
  onClose,
  entries,
  getExistingShifts,
  onApply,
  isApplying,
}: FavoriteApplyDialogProps) {
  const [step, setStep] = useState<DialogStep>("list");
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeFavoriteEntry | null>(null);
  const [selectedFavoriteIndex, setSelectedFavoriteIndex] = useState<string>("0");

  const resetState = useCallback(() => {
    setStep("list");
    setSelectedEmployee(null);
    setSelectedFavoriteIndex("0");
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleSelectEmployee = useCallback((entry: EmployeeFavoriteEntry) => {
    setSelectedEmployee(entry);
    setSelectedFavoriteIndex("0");
    setStep("select");
  }, []);

  const handleBack = useCallback(() => {
    if (step === "confirm") {
      setStep("select");
    } else {
      setStep("list");
      setSelectedEmployee(null);
    }
  }, [step]);

  const handleProceedToConfirm = useCallback(() => {
    if (!selectedEmployee) return;

    const existingShifts = getExistingShifts(selectedEmployee.employee.user_id);
    if (existingShifts.length > 0) {
      setStep("confirm");
    } else {
      // No existing shifts, apply directly
      onApply(selectedEmployee.employee.user_id, parseInt(selectedFavoriteIndex, 10));
      handleClose();
    }
  }, [selectedEmployee, getExistingShifts, selectedFavoriteIndex, onApply, handleClose]);

  const handleConfirmApply = useCallback(() => {
    if (!selectedEmployee) return;
    onApply(selectedEmployee.employee.user_id, parseInt(selectedFavoriteIndex, 10));
    handleClose();
  }, [selectedEmployee, selectedFavoriteIndex, onApply, handleClose]);

  // Format shifts summary
  const formatFavoriteSummary = (fav: NamedFavorite): string => {
    const dayNames = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
    const uniqueDays = [...new Set(fav.shifts.map((s) => dayNames[s.dayOfWeek]))];
    return `${fav.shifts.length} shift${fav.shifts.length > 1 ? "s" : ""} (${uniqueDays.join(", ")})`;
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
            {step === "list" && "Appliquer un favori"}
            {step === "select" && (selectedEmployee?.employee.full_name ?? "Favori")}
            {step === "confirm" && "Confirmation"}
          </DialogTitle>
          <DialogDescription>
            {step === "list" && "Choisissez un employe pour appliquer son planning favori."}
            {step === "select" && "Selectionnez le favori a appliquer."}
            {step === "confirm" && "Des shifts existent deja pour cette semaine."}
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1: Employee list */}
        {step === "list" && (
          <div className="space-y-1 py-2 max-h-[300px] overflow-y-auto">
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Aucun favori enregistre.
              </p>
            ) : (
              entries.map((entry) => (
                <Button
                  key={entry.employee.user_id}
                  variant="ghost"
                  className="w-full justify-start h-auto py-2"
                  onClick={() => handleSelectEmployee(entry)}
                >
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{entry.employee.full_name ?? "Sans nom"}</span>
                    <span className="text-xs text-muted-foreground">
                      {entry.favorites.length} favori{entry.favorites.length > 1 ? "s" : ""}
                    </span>
                  </div>
                </Button>
              ))
            )}
          </div>
        )}

        {/* STEP 2: Favorite selection */}
        {step === "select" && selectedEmployee && (
          <div className="space-y-4 py-2">
            {selectedEmployee.favorites.length === 1 ? (
              <div className="p-3 border rounded-md bg-muted/30">
                <p className="font-medium">{selectedEmployee.favorites[0].name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatFavoriteSummary(selectedEmployee.favorites[0])}
                </p>
              </div>
            ) : (
              <RadioGroup value={selectedFavoriteIndex} onValueChange={setSelectedFavoriteIndex}>
                {selectedEmployee.favorites.map((fav, i) => (
                  <div key={i} className="flex items-start space-x-2 p-2 border rounded-md">
                    <RadioGroupItem value={String(i)} id={`apply-fav-${i}`} className="mt-0.5" />
                    <Label htmlFor={`apply-fav-${i}`} className="cursor-pointer flex-1">
                      <span className="font-medium">{fav.name}</span>
                      <br />
                      <span className="text-xs text-muted-foreground">
                        {formatFavoriteSummary(fav)}
                      </span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          </div>
        )}

        {/* STEP 3: Conflict confirmation */}
        {step === "confirm" && selectedEmployee && (
          <div className="py-2">
            <p className="text-sm">
              Des shifts existent deja pour{" "}
              <strong>{selectedEmployee.employee.full_name ?? "cet employe"}</strong> cette semaine.
              Ils seront <strong>remplaces</strong> par le favori.
            </p>
          </div>
        )}

        <DialogFooter>
          {step !== "list" && (
            <Button variant="ghost" onClick={handleBack} disabled={isApplying} className="mr-auto">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Retour
            </Button>
          )}
          <Button variant="outline" onClick={handleClose} disabled={isApplying}>
            Annuler
          </Button>
          {step === "select" && (
            <Button onClick={handleProceedToConfirm} disabled={isApplying}>
              {isApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Appliquer
            </Button>
          )}
          {step === "confirm" && (
            <Button onClick={handleConfirmApply} disabled={isApplying} variant="destructive">
              {isApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remplacer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
