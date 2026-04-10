/**
 * BadgeuseBackfillTab - Desktop only
 * Pre-fill badge_events from planning_shifts
 * ISOLATED: Can be deleted without affecting other modules
 *
 * Modes:
 * - skip: Only fill days without existing events
 * - replace: Delete existing events and recreate from planning
 *
 * Source: planning_shifts (read-only)
 * Target: badge_events (insert/delete)
 */

import { useState } from "react";
import { format, differenceInDays, isBefore, isAfter } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Calendar as CalendarIcon,
  AlertCircle,
  CheckCircle2,
  Info,
  Sparkles,
  RefreshCw,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useBadgeuseBackfill, type BackfillPreview } from "@/hooks/badgeuse/useBadgeuseBackfill";

interface BadgeuseBackfillTabProps {
  establishmentId: string | null;
}

export function BadgeuseBackfillTab({ establishmentId }: BadgeuseBackfillTabProps) {
  // Date range state
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  // Mode state: skip or replace
  const [mode, setMode] = useState<"skip" | "replace">("replace");

  // Preview state
  const [preview, setPreview] = useState<BackfillPreview | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Mutations
  const {
    preview: previewMutation,
    execute: executeMutation,
    isPreviewing,
    isExecuting,
  } = useBadgeuseBackfill();

  // Validation
  const isValidRange = startDate && endDate && !isAfter(startDate, endDate);
  const daysCovered = isValidRange ? differenceInDays(endDate!, startDate!) + 1 : 0;
  const maxDays = 31;
  const isTooLong = daysCovered > maxDays;

  // Handle preview
  const handlePreview = async () => {
    if (!establishmentId || !startDate || !endDate) return;

    setPreview(null);
    setShowConfirm(false);

    try {
      const result = await previewMutation.mutateAsync({
        establishmentId,
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd"),
      });
      setPreview(result);
      setShowConfirm(true);
    } catch (_error) {
      // Error handled by mutation
    }
  };

  // Handle execute
  const handleExecute = async () => {
    if (!establishmentId || !startDate || !endDate) return;

    try {
      await executeMutation.mutateAsync({
        establishmentId,
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd"),
        mode,
      });
      setShowConfirm(false);
      setPreview(null);
      setStartDate(undefined);
      setEndDate(undefined);
    } catch (_error) {
      // Error handled by mutation
    }
  };

  // Reset
  const handleReset = () => {
    setStartDate(undefined);
    setEndDate(undefined);
    setPreview(null);
    setShowConfirm(false);
  };

  return (
    <div className="max-w-2xl space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Pré-remplissage automatique</h2>
            <p className="text-sm text-muted-foreground">
              Créez des pointages à partir du planning validé
            </p>
          </div>
        </div>
      </div>

      {/* Mode Selection */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-muted-foreground">Mode</label>
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant={mode === "replace" ? "default" : "outline"}
            onClick={() => {
              setMode("replace");
              setPreview(null);
              setShowConfirm(false);
            }}
            className={cn(
              "h-16 flex-col gap-1 rounded-xl",
              mode === "replace" && "ring-2 ring-primary ring-offset-2"
            )}
          >
            <RefreshCw className="h-5 w-5" />
            <span className="text-xs font-medium">Remplacer</span>
          </Button>
          <Button
            variant={mode === "skip" ? "default" : "outline"}
            onClick={() => {
              setMode("skip");
              setPreview(null);
              setShowConfirm(false);
            }}
            className={cn(
              "h-16 flex-col gap-1 rounded-xl",
              mode === "skip" && "ring-2 ring-primary ring-offset-2"
            )}
          >
            <SkipForward className="h-5 w-5" />
            <span className="text-xs font-medium">Ignorer existants</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center">
          {mode === "replace"
            ? "Supprime les pointages existants et recrée tout depuis le planning"
            : "Ne modifie pas les pointages existants, remplit uniquement les jours vides"}
        </p>
      </div>

      {/* Info */}
      {mode === "replace" ? (
        <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 dark:bg-amber-950/50">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-amber-700 dark:text-amber-300">
            <strong>Attention :</strong> Les pointages existants seront supprimés et recréés à
            partir des horaires du planning.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/50">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertDescription className="text-blue-700 dark:text-blue-300">
            Les pointages existants ne seront pas modifiés. Seuls les jours sans pointage seront
            remplis.
          </AlertDescription>
        </Alert>
      )}

      {/* Date Selection - Clean Apple-style layout */}
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Start Date */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Du</label>
            <Popover open={startOpen} onOpenChange={setStartOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full h-14 justify-start text-left font-normal rounded-xl border-2 transition-all",
                    startDate
                      ? "border-primary/50 bg-primary/5"
                      : "border-muted hover:border-muted-foreground/30"
                  )}
                >
                  <CalendarIcon className="mr-3 h-5 w-5 text-muted-foreground" />
                  <span className={cn("text-base", !startDate && "text-muted-foreground")}>
                    {startDate
                      ? format(startDate, "d MMMM yyyy", { locale: fr })
                      : "Sélectionner une date"}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={(date) => {
                    setStartDate(date);
                    setStartOpen(false);
                    setPreview(null);
                    setShowConfirm(false);
                  }}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* End Date */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Au</label>
            <Popover open={endOpen} onOpenChange={setEndOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full h-14 justify-start text-left font-normal rounded-xl border-2 transition-all",
                    endDate
                      ? "border-primary/50 bg-primary/5"
                      : "border-muted hover:border-muted-foreground/30"
                  )}
                >
                  <CalendarIcon className="mr-3 h-5 w-5 text-muted-foreground" />
                  <span className={cn("text-base", !endDate && "text-muted-foreground")}>
                    {endDate
                      ? format(endDate, "d MMMM yyyy", { locale: fr })
                      : "Sélectionner une date"}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={endDate}
                  onSelect={(date) => {
                    setEndDate(date);
                    setEndOpen(false);
                    setPreview(null);
                    setShowConfirm(false);
                  }}
                  disabled={(date) => (startDate ? isBefore(date, startDate) : false)}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Duration indicator */}
        {isValidRange && (
          <div className="flex items-center justify-center">
            <span className="px-4 py-2 bg-muted rounded-full text-sm font-medium">
              {daysCovered} jour{daysCovered > 1 ? "s" : ""} sélectionné{daysCovered > 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Validation errors */}
        {isTooLong && (
          <Alert variant="destructive" className="rounded-xl">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              La période est trop longue (maximum {maxDays} jours)
            </AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            onClick={handlePreview}
            disabled={!isValidRange || isTooLong || isPreviewing || !establishmentId}
            className="flex-1 h-12 rounded-xl text-base font-medium"
          >
            {isPreviewing ? "Analyse en cours..." : "Prévisualiser"}
          </Button>

          {(startDate || endDate) && (
            <Button variant="ghost" onClick={handleReset} className="h-12 px-6 rounded-xl">
              Réinitialiser
            </Button>
          )}
        </div>
      </div>

      {/* Preview results */}
      {preview && showConfirm && (
        <div className="p-6 rounded-2xl border-2 border-primary bg-primary/5 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-full">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-semibold">Résumé avant confirmation</h3>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-background rounded-xl">
              <div className="text-3xl font-bold text-foreground">{preview.days_covered}</div>
              <div className="text-sm text-muted-foreground mt-1">
                jour{preview.days_covered > 1 ? "s" : ""}
              </div>
            </div>
            <div className="text-center p-4 bg-background rounded-xl">
              <div className="text-3xl font-bold text-foreground">{preview.shifts_found}</div>
              <div className="text-sm text-muted-foreground mt-1">
                shift{preview.shifts_found > 1 ? "s" : ""}
              </div>
            </div>
            <div className="text-center p-4 bg-background rounded-xl">
              <div className="text-3xl font-bold text-primary">{preview.events_to_create}</div>
              <div className="text-sm text-muted-foreground mt-1">à créer</div>
            </div>
          </div>

          {preview.events_to_create === 0 ? (
            <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 dark:bg-amber-950/50">
              <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="text-amber-700 dark:text-amber-300">
                Aucun pointage à créer. Les pointages existent déjà ou il n'y a pas de shifts
                planifiés.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex gap-3">
              <Button
                onClick={handleExecute}
                disabled={isExecuting}
                className="flex-1 h-12 rounded-xl text-base font-medium"
              >
                {isExecuting
                  ? "Création en cours..."
                  : `Créer ${preview.events_to_create} pointage${preview.events_to_create > 1 ? "s" : ""}`}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowConfirm(false)}
                className="h-12 px-6 rounded-xl"
              >
                Annuler
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
