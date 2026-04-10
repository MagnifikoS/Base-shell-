import { cn } from "@/lib/utils";
import { ALERT_TYPE_META } from "./types";
import type { WizardState } from "./types";

interface Props {
  state: WizardState;
  currentStep: number;
  onGoToStep?: (step: number) => void;
  /** Render as a compact horizontal bar */
  horizontal?: boolean;
}

const STEP_LABELS = [
  "Situation",
  "Destinataires",
  "Stratégie & Messages",
];

export function WizardSummary({ state, currentStep, onGoToStep, horizontal }: Props) {
  const alertMeta = ALERT_TYPE_META[state.alertType];
  const hasRoles = state.selectedRoleIds.length > 0;

  const subTypeText = "";

  const roleSummaries = state.selectedRoleIds
    .map((roleId) => {
      const s = state.strategies[roleId];
      if (!s) return null;
      const delay = s.delayMinutes === "" ? "?" : s.delayMinutes;
      let text = `${s.roleName} après ${delay} min`;
      if (s.remindersEnabled) {
        const max = s.maxReminders === "" ? "?" : s.maxReminders;
        const interval = s.reminderIntervalMinutes === "" ? "?" : s.reminderIntervalMinutes;
        text += ` (${max} rappels toutes les ${interval} min`;
        if (s.includeEmployeeName) text += ", nominatif";
        text += ")";
      } else if (s.includeEmployeeName) {
        text += " (nominatif)";
      }
      return text;
    })
    .filter(Boolean);

  if (horizontal) {
    return (
      <div className="rounded-xl border bg-muted/30 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">
            <span className="text-muted-foreground">Si </span>
            <span className="font-medium">{alertMeta.label.toLowerCase()}</span>
            <span className="text-muted-foreground">{subTypeText}</span>
            {roleSummaries.length > 0 && (
              <>
                <span className="text-muted-foreground"> → </span>
                <span className="text-muted-foreground">{roleSummaries.join(" · ")}</span>
              </>
            )}
            {!hasRoles && (
              <span className="text-muted-foreground italic"> — aucun destinataire</span>
            )}
          </p>
        </div>

        {onGoToStep && (
          <div className="flex flex-wrap gap-1.5">
            {STEP_LABELS.map((label, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onGoToStep(i)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
                  currentStep === i
                    ? "bg-primary text-primary-foreground"
                    : "bg-background border text-muted-foreground hover:text-foreground hover:border-primary/40"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-4">
      <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
        Résumé du scénario
      </h4>

      {onGoToStep && (
        <div className="flex flex-wrap gap-1.5">
          {STEP_LABELS.map((label, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onGoToStep(i)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
                currentStep === i
                  ? "bg-primary text-primary-foreground"
                  : "bg-background border text-muted-foreground hover:text-foreground hover:border-primary/40"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2 text-sm">
        <p>
          <span className="text-muted-foreground">Si</span>{" "}
          <span className="font-medium">{alertMeta.label.toLowerCase()}</span>
          <span className="text-muted-foreground">{subTypeText}</span>
        </p>

        {hasRoles ? (
          roleSummaries.map((text, i) => (
            <p key={i} className="text-muted-foreground">
              → notifier {text}
            </p>
          ))
        ) : (
          <p className="text-muted-foreground italic">Aucun destinataire sélectionné</p>
        )}
      </div>
    </div>
  );
}
