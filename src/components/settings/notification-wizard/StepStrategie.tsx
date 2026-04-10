import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { RoleStrategy, WizardState } from "./types";

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

/** Check if a role name looks like "Salarié" / "Employé" */
function isEmployeeRole(roleName: string): boolean {
  const n = roleName.toLowerCase();
  return n.includes("salarié") || n.includes("salarie") || n.includes("employé") || n.includes("employe");
}

function NumericInput({
  value,
  onChange,
  disabled,
  min = 0,
  max,
  className,
}: {
  value: number | "";
  onChange: (v: number | "") => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <Input
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      className={cn("w-24 text-center", className)}
      value={value === "" ? "" : value}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          onChange("");
          return;
        }
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n >= 0) {
          onChange(max ? Math.min(max, n) : n);
        }
      }}
    />
  );
}

export function StepStrategie({ state, onChange }: Props) {
  const roleIds = state.selectedRoleIds;

  const updateStrategy = (roleId: string, patch: Partial<RoleStrategy>) => {
    onChange({
      strategies: {
        ...state.strategies,
        [roleId]: { ...state.strategies[roleId], ...patch },
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-1">
          ⚙️ Stratégie & Messages par rôle
        </h3>
        <p className="text-sm text-muted-foreground">
          Configurez le délai, les rappels et les messages pour chaque destinataire.
        </p>
      </div>

      <div className="space-y-6">
        {roleIds.map((roleId) => {
          const s = state.strategies[roleId];
          if (!s) return null;
          const isEmployee = isEmployeeRole(s.roleName);

          return (
            <div
              key={roleId}
              className="rounded-xl border bg-card p-6 space-y-6"
            >
              <h4 className="text-sm font-semibold text-foreground">
                Stratégie pour{" "}
                <span className="text-primary">{s.roleName}</span>
              </h4>

              {/* ── SECTION 1: Premier envoi ── */}
              <div className="space-y-4">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                  Premier envoi
                </Label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm text-foreground">
                      Délai avant premier envoi (minutes)
                    </Label>
                    <NumericInput
                      value={s.delayMinutes}
                      onChange={(v) => updateStrategy(roleId, { delayMinutes: v })}
                      min={1}
                      max={120}
                    />
                  </div>
                </div>

                {/* Initial message */}
                <div className="space-y-1.5">
                  <Label className="text-sm text-foreground">
                    Message du premier envoi <span className="text-destructive">*</span>
                  </Label>
                  <textarea
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm min-h-[70px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Ex: Un salarié n'a pas badgé son arrivée"
                    value={s.initialMessageBody}
                    onChange={(e) => updateStrategy(roleId, { initialMessageBody: e.target.value })}
                  />
                </div>

                {/* Include employee name — only for non-employee roles */}
                {!isEmployee && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={s.includeEmployeeName}
                      onCheckedChange={(checked) =>
                        updateStrategy(roleId, { includeEmployeeName: !!checked })
                      }
                    />
                    Inclure le nom du salarié concerné
                  </label>
                )}
              </div>

              {/* ── SECTION 2: Rappels automatiques ── */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                    Rappels automatiques (facultatif)
                  </Label>
                  <Switch
                    checked={s.remindersEnabled}
                    onCheckedChange={(checked) => {
                      const patch: Partial<RoleStrategy> = {
                        remindersEnabled: checked,
                      };
                      if (!checked) {
                        patch.reminderIntervalMinutes = "";
                        patch.maxReminders = "";
                        patch.reminderMessageBody = "";
                        patch.finalReminderEnabled = false;
                        patch.finalReminderBody = "";
                      }
                      updateStrategy(roleId, patch);
                    }}
                  />
                </div>

                <div className={cn(
                  "grid grid-cols-1 sm:grid-cols-2 gap-4 transition-opacity",
                  !s.remindersEnabled && "opacity-40 pointer-events-none"
                )}>
                  <div className="space-y-1.5">
                    <Label className="text-sm text-foreground">
                      Intervalle entre rappels (minutes)
                    </Label>
                    <NumericInput
                      value={s.reminderIntervalMinutes}
                      onChange={(v) => updateStrategy(roleId, { reminderIntervalMinutes: v })}
                      disabled={!s.remindersEnabled}
                      min={1}
                      max={120}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm text-foreground">
                      Maximum de rappels
                    </Label>
                    <NumericInput
                      value={s.maxReminders}
                      onChange={(v) => updateStrategy(roleId, { maxReminders: v })}
                      disabled={!s.remindersEnabled}
                      min={1}
                      max={10}
                    />
                  </div>
                </div>

                {/* Reminder message */}
                <div className={cn(
                  "space-y-1.5 transition-opacity",
                  !s.remindersEnabled && "opacity-40 pointer-events-none"
                )}>
                  <Label className="text-sm text-foreground">
                    Message des rappels {s.remindersEnabled && <span className="text-destructive">*</span>}
                  </Label>
                  <textarea
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm min-h-[70px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Ex: Rappel — un salarié n'a toujours pas badgé"
                    value={s.reminderMessageBody}
                    disabled={!s.remindersEnabled}
                    onChange={(e) => updateStrategy(roleId, { reminderMessageBody: e.target.value })}
                  />
                </div>

                {/* Final reminder */}
                <div className={cn(
                  "space-y-3 transition-opacity",
                  !s.remindersEnabled && "opacity-40 pointer-events-none"
                )}>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={s.finalReminderEnabled}
                      disabled={!s.remindersEnabled}
                      onCheckedChange={(checked) =>
                        updateStrategy(roleId, {
                          finalReminderEnabled: !!checked,
                          ...(!checked ? { finalReminderBody: "" } : {}),
                        })
                      }
                    />
                    Message spécifique pour le dernier rappel
                  </label>
                  {s.finalReminderEnabled && s.remindersEnabled && (
                    <div className="space-y-1.5">
                      <Label className="text-sm text-foreground">
                        Message du dernier rappel <span className="text-destructive">*</span>
                      </Label>
                      <textarea
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm min-h-[60px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="Ex: URGENT — un salarié n'a toujours pas badgé !"
                        value={s.finalReminderBody}
                        onChange={(e) => updateStrategy(roleId, { finalReminderBody: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
