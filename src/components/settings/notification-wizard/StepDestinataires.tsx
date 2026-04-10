import { cn } from "@/lib/utils";
import { Users, UserCheck, Shield, Crown } from "lucide-react";
import type { Role, WizardState } from "./types";

const ROLE_ICONS: Record<string, typeof Users> = {
  default: Users,
  salarié: UserCheck,
  salarie: UserCheck,
  directeur: Crown,
  administrateur: Shield,
  admin: Shield,
};

function getRoleIcon(name: string) {
  const lower = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return ROLE_ICONS[lower] ?? ROLE_ICONS.default;
}

interface Props {
  state: WizardState;
  roles: Role[];
  onChange: (patch: Partial<WizardState>) => void;
}

export function StepDestinataires({ state, roles, onChange }: Props) {
  const toggle = (roleId: string) => {
    const next = state.selectedRoleIds.includes(roleId)
      ? state.selectedRoleIds.filter((r) => r !== roleId)
      : [...state.selectedRoleIds, roleId];
    onChange({ selectedRoleIds: next });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-1">
          👥 Qui doit être informé ?
        </h3>
        <p className="text-sm text-muted-foreground">
          Sélectionnez un ou plusieurs rôles. Chacun aura sa propre stratégie de notification.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {roles.map((role) => {
          const selected = state.selectedRoleIds.includes(role.id);
          const Icon = getRoleIcon(role.name);
          return (
            <button
              key={role.id}
              type="button"
              onClick={() => toggle(role.id)}
              className={cn(
                "flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all",
                selected
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border hover:border-primary/40 hover:bg-accent/50"
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium">{role.name}</span>
            </button>
          );
        })}
      </div>

      {state.selectedRoleIds.length === 0 && (
        <p className="text-sm text-destructive flex items-center gap-1.5">
          <span>⚠</span> Sélectionnez au moins un rôle pour continuer.
        </p>
      )}
    </div>
  );
}
