/**
 * CopyWeekBulkModal — Modale pour copier la semaine précédente (bulk)
 * 
 * RÈGLES PHASE 3 :
 * - Frontend = orchestrateur (boucle sur userId visibles)
 * - Chaque shift passe par le backend existant → realtime → invalidation
 * - Aucune logique métier frontend
 * - Aucun bypass validation / RBAC
 * 
 * RÈGLES UX (v2) :
 * - Si semaine vide → copie immédiate SANS popup
 * - Sinon → popup Ajouter/Remplacer
 * - Fermeture auto après confirmation
 * - Pas de récap "X shifts copiés", juste realtime
 */
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useCopyPreviousWeek } from "@/components/planning/hooks/usePlanningBulkActions";
import { useQueryClient } from "@tanstack/react-query";

interface CopyWeekBulkModalProps {
  isOpen: boolean;
  onClose: () => void;
  establishmentId: string;
  weekStart: string;
  /** Liste des userId visibles dans la vue actuelle (général ou département) */
  visibleUserIds: string[];
  /** Nom du département actif (null = Planning général) */
  activeDepartmentLabel: string | null;
  /** Y a-t-il des jours validés cette semaine ? */
  hasValidatedDays: boolean;
  /** La semaine entière est-elle validée ? */
  weekValidated: boolean;
  /** Semaine cible a-t-elle des shifts dans le périmètre courant ? */
  hasExistingShifts: boolean;
}

type CopyMode = "merge" | "replace";

interface CopyResult {
  successCount: number;
  failedCount: number;
}

export function CopyWeekBulkModal({
  isOpen,
  onClose,
  establishmentId,
  weekStart,
  visibleUserIds,
  activeDepartmentLabel,
  hasValidatedDays,
  weekValidated,
  hasExistingShifts,
}: CopyWeekBulkModalProps) {
  const [step, setStep] = useState<"mode" | "confirm">("mode");
  const [copyMode, setCopyMode] = useState<CopyMode>("merge");
  const [isProcessing, setIsProcessing] = useState(false);

  const copyMutation = useCopyPreviousWeek();
  const queryClient = useQueryClient();

  // Reset state on close
  const handleClose = useCallback(() => {
    if (isProcessing) return; // Block close during processing
    setStep("mode");
    setCopyMode("merge");
    onClose();
  }, [isProcessing, onClose]);

  // ✅ UX: Si semaine vide → copie immédiate dès l'ouverture
  useEffect(() => {
    if (isOpen && !hasExistingShifts && !isProcessing) {
      // Semaine vide, pas de popup → copie directe en mode "merge"
      startCopyProcess("merge");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, hasExistingShifts]);

  // Handle mode selection → check if confirmation needed
  const handleModeConfirm = () => {
    if (weekValidated || hasValidatedDays) {
      setStep("confirm");
    } else {
      startCopyProcess(copyMode);
    }
  };

  /**
   * Run mutations in parallel with concurrency limit for performance.
   * Returns count of successes and failures for reporting.
   */
  const runWithConcurrency = async <T,>(
    items: T[],
    fn: (item: T) => Promise<void>,
    limit: number
  ): Promise<CopyResult> => {
    const executing: Promise<void>[] = [];
    let successCount = 0;
    let failedCount = 0;
    
    for (const item of items) {
      const p = fn(item)
        .then(() => {
          successCount++;
        })
        .catch(() => {
          failedCount++;
        });
      executing.push(p);
      
      if (executing.length >= limit) {
        await Promise.race(executing);
        // Remove completed promises
        for (let i = executing.length - 1; i >= 0; i--) {
          // Check if promise is settled by racing with resolved
          const settled = await Promise.race([
            executing[i].then(() => true).catch(() => true),
            Promise.resolve(false),
          ]);
          if (settled) {
            executing.splice(i, 1);
          }
        }
      }
    }
    
    // Wait for remaining
    await Promise.all(executing);
    
    return { successCount, failedCount };
  };

  // Start the bulk copy process (parallel with concurrency) + auto-close + reporting
  const startCopyProcess = async (mode: CopyMode) => {
    setIsProcessing(true);

    const CONCURRENCY_LIMIT = 6; // Parallel mutations limit

    const result = await runWithConcurrency(
      visibleUserIds,
      async (userId) => {
        await copyMutation.mutateAsync({
          establishmentId,
          weekStart,
          userId,
          mode,
        });
      },
      CONCURRENCY_LIMIT
    );

    // ✅ FIX: Report success/failure to user
    if (result.failedCount > 0) {
      toast.warning(
        `Copie terminée : ${result.successCount} réussi${result.successCount > 1 ? "s" : ""}, ${result.failedCount} échoué${result.failedCount > 1 ? "s" : ""}`,
        { duration: 5000 }
      );
    } else if (result.successCount > 0) {
      toast.success(`${result.successCount} salarié${result.successCount > 1 ? "s" : ""} copié${result.successCount > 1 ? "s" : ""}`, { duration: 3000 });
    }

    // ✅ GARDE-FOU ANTI-SPAM : invalidation unique FINALE (le realtime gère le reste)
    queryClient.invalidateQueries({
      queryKey: ["planning-week", establishmentId, weekStart],
    });
    queryClient.invalidateQueries({
      queryKey: ["personnel-leaves", establishmentId],
      exact: false,
    });

    setIsProcessing(false);
    // ✅ UX: Fermeture automatique après copie
    handleClose();
  };

  const scopeLabel = activeDepartmentLabel
    ? `le département ${activeDepartmentLabel}`
    : "tous les salariés visibles";

  // ✅ UX: Si pas de shifts existants et isOpen, on est en mode "copie directe" 
  // → afficher juste un loader léger, pas de popup
  if (isOpen && !hasExistingShifts) {
    return (
      <AlertDialog open={isOpen}>
        <AlertDialogContent className="max-w-xs">
          <div className="flex items-center justify-center gap-3 py-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Copie en cours…</span>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <AlertDialogContent className="max-w-md">
        {/* STEP 1: Mode selection (Ajouter / Remplacer) */}
        {step === "mode" && !isProcessing && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Copier la semaine précédente</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  Des shifts existent déjà pour{" "}
                  <strong>{scopeLabel}</strong> ({visibleUserIds.length} salarié
                  {visibleUserIds.length > 1 ? "s" : ""}).
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="py-4">
              <RadioGroup
                value={copyMode}
                onValueChange={(v) => setCopyMode(v as CopyMode)}
                className="space-y-3"
              >
                <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="merge" id="merge" className="mt-0.5" />
                  <div className="flex-1">
                    <Label htmlFor="merge" className="font-medium cursor-pointer">
                      Ajouter uniquement
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Garde les shifts existants, ne remplit que les jours vides
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="replace" id="replace" className="mt-0.5" />
                  <div className="flex-1">
                    <Label htmlFor="replace" className="font-medium cursor-pointer">
                      Remplacer
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Supprime d'abord les shifts du périmètre, puis copie
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            <AlertDialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Annuler
              </Button>
              <Button onClick={handleModeConfirm} disabled={visibleUserIds.length === 0}>
                Continuer
              </Button>
            </AlertDialogFooter>
          </>
        )}

        {/* STEP 2: Confirmation (jours validés) */}
        {step === "confirm" && !isProcessing && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-warning">
                <AlertTriangle className="h-5 w-5" />
                Confirmation requise
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  {weekValidated
                    ? "La semaine entière est validée."
                    : "Certains jours sont validés."}
                </span>
                <span className="block font-medium text-foreground">
                  Le backend refusera la copie sur les jours validés. Voulez-vous continuer ?
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <Button variant="outline" onClick={() => setStep("mode")}>
                Retour
              </Button>
              <Button variant="default" onClick={() => startCopyProcess(copyMode)}>
                Continuer quand même
              </Button>
            </AlertDialogFooter>
          </>
        )}

        {/* Processing state (in-modal feedback) */}
        {isProcessing && (
          <div className="flex items-center justify-center gap-3 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Copie en cours…</span>
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
