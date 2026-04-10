import { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { StepSituation } from "./StepSituation";
import { StepDestinataires } from "./StepDestinataires";
import { StepStrategie } from "./StepStrategie";
import { WizardSummary } from "./WizardSummary";
import {
  createEmptyWizardState,
  getDefaultStrategy,
  type Role,
  type WizardState,
} from "./types";

const STEP_COUNT = 3;
const STEP_TITLES = ["Situation", "Destinataires", "Stratégie & Messages"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
  onSave: (state: WizardState) => Promise<void>;
  initialState?: WizardState | null;
  startAtSummary?: boolean;
}

export function WizardModal({ open, onOpenChange, roles, onSave, initialState, startAtSummary }: Props) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(createEmptyWizardState());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialState) {
        setState(initialState);
        setStep(startAtSummary ? 2 : 0);
      } else {
        setState(createEmptyWizardState());
        setStep(0);
      }
    }
  }, [open, initialState, startAtSummary]);

  const patch = useCallback((p: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...p }));
  }, []);

  useEffect(() => {
    setState((prev) => {
      const newStrategies = { ...prev.strategies };

      for (const roleId of prev.selectedRoleIds) {
        const role = roles.find((r) => r.id === roleId);
        const roleName = role?.name ?? roleId;
        if (!newStrategies[roleId]) {
          newStrategies[roleId] = getDefaultStrategy(roleId, roleName, prev.alertType);
        }
      }

      return { ...prev, strategies: newStrategies };
    });
  }, [state.selectedRoleIds, state.alertType, roles]);

  const canContinue = () => {
    if (step === 1) return state.selectedRoleIds.length > 0;
    return true;
  };

  const getValidationErrors = (): string[] => {
    const errors: string[] = [];
    if (state.selectedRoleIds.length === 0) {
      errors.push("Aucun destinataire sélectionné");
      return errors;
    }
    for (const roleId of state.selectedRoleIds) {
      const s = state.strategies[roleId];
      if (!s) continue;
      const name = s.roleName || roleId;
      if (s.delayMinutes === "" || (typeof s.delayMinutes === "number" && s.delayMinutes < 1)) {
        errors.push(`${name} : délai avant premier envoi manquant`);
      }
      if (!(s.initialMessageBody ?? "").trim()) {
        errors.push(`${name} : message du premier envoi manquant`);
      }
      if (s.remindersEnabled) {
        if (s.reminderIntervalMinutes === "" || (typeof s.reminderIntervalMinutes === "number" && s.reminderIntervalMinutes < 1)) {
          errors.push(`${name} : intervalle de rappel manquant`);
        }
        if (s.maxReminders === "" || (typeof s.maxReminders === "number" && s.maxReminders < 1)) {
          errors.push(`${name} : maximum de rappels manquant`);
        }
        if (!(s.reminderMessageBody ?? "").trim()) {
          errors.push(`${name} : message des rappels manquant`);
        }
        if (s.finalReminderEnabled && !(s.finalReminderBody ?? "").trim()) {
          errors.push(`${name} : message du dernier rappel manquant`);
        }
      }
    }
    return errors;
  };

  const handleSave = async () => {
    const errors = getValidationErrors();
    if (errors.length > 0) {
      toast.error("Informations manquantes", {
        description: errors.join("\n"),
        duration: 5000,
      });
      return;
    }
    setSaving(true);
    try {
      await onSave(state);
      onOpenChange(false);
    } catch {
      // error handled by caller
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in-0"
        onClick={() => onOpenChange(false)}
      />

      <div className="relative z-10 w-full max-w-3xl max-h-[90vh] mx-4 rounded-2xl bg-background border shadow-2xl flex flex-col animate-in zoom-in-95 fade-in-0 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">
              {initialState ? "Modifier le scénario d'alerte" : "Créer un scénario d'alerte"}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Configurez quand et qui doit être notifié automatiquement.
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary + progress */}
        <div className="px-6 pt-4 pb-2 space-y-3">
          <WizardSummary
            state={state}
            currentStep={step}
            onGoToStep={setStep}
            horizontal
          />
          <div className="flex items-center gap-1">
            {Array.from({ length: STEP_COUNT }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i <= step ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Étape {step + 1} sur {STEP_COUNT} — {STEP_TITLES[step]}
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="min-w-0">
            {step === 0 && <StepSituation state={state} onChange={patch} />}
            {step === 1 && <StepDestinataires state={state} roles={roles} onChange={patch} />}
            {step === 2 && <StepStrategie state={state} onChange={patch} />}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
            Retour
          </Button>

          {step < STEP_COUNT - 1 ? (
            <Button
              onClick={() => setStep((s) => Math.min(STEP_COUNT - 1, s + 1))}
              disabled={!canContinue()}
              className="gap-1.5"
            >
              Continuer
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gap-1.5"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {initialState ? "Enregistrer" : "Créer la règle"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
