import { cn } from "@/lib/utils";
import { Clock, Ban, DoorOpen } from "lucide-react";
import type { AlertType, WizardState } from "./types";
import { ALERT_TYPE_META } from "./types";

const ALERT_ICONS: Record<AlertType, typeof Clock> = {
  late: Clock,
  no_badge_arrival: Ban,
  no_badge_departure: DoorOpen,
};

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

export function StepSituation({ state, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-1">
          ⚠️ Dans quelle situation envoyer la notification ?
        </h3>
        <p className="text-sm text-muted-foreground">
          Sélectionnez le type d'anomalie à surveiller.
        </p>
      </div>

      <div className="grid gap-3">
        {(Object.keys(ALERT_TYPE_META) as AlertType[]).map((type) => {
          const meta = ALERT_TYPE_META[type];
          const Icon = ALERT_ICONS[type];
          const selected = state.alertType === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => onChange({ alertType: type })}
              className={cn(
                "flex items-start gap-4 rounded-xl border-2 p-4 text-left transition-all",
                selected
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border hover:border-primary/40 hover:bg-accent/50"
              )}
            >
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm">{meta.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* noBadgeSubType radio removed — arrival/departure are now separate alert_types */}
    </div>
  );
}
