import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Power, PowerOff, Trash2, Timer, Clock } from "lucide-react";
import type { BreakPolicyRecord } from "./types/breakPolicy.types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface BreakRuleListProps {
  policies: BreakPolicyRecord[];
  isLoading: boolean;
  onActivate: (id: string) => void;
  onDeactivate: (id: string) => void;
  onDelete: (id: string) => void;
  isActivating: boolean;
  isDeactivating: boolean;
  isDeleting: boolean;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPolicyType(policy: BreakPolicyRecord["policy_json"]): "DURATION" | "TIMEPOINTS" {
  if ("type" in policy && policy.type === "TIMEPOINTS") {
    return "TIMEPOINTS";
  }
  return "DURATION";
}

function getPolicyBadgeInfo(policy: BreakPolicyRecord["policy_json"]) {
  const type = getPolicyType(policy);
  if (type === "TIMEPOINTS") {
    return { label: "Heures", icon: Clock, variant: "outline" as const };
  }
  return { label: "Durée", icon: Timer, variant: "secondary" as const };
}

function renderPolicySummary(policy: BreakPolicyRecord["policy_json"]) {
  const type = getPolicyType(policy);

  if (type === "TIMEPOINTS" && "rules" in policy) {
    const rules = policy.rules as { time: string; break_minutes: number }[];
    return (
      <div className="text-xs text-muted-foreground">
        {rules.map((rule, idx) => (
          <span key={idx}>
            {rule.time}({rule.break_minutes}){idx < rules.length - 1 && ", "}
          </span>
        ))}
      </div>
    );
  }

  // DURATION type
  if ("rules" in policy) {
    const rules = policy.rules as { min_shift_minutes: number; break_minutes: number }[];
    return (
      <div className="text-xs text-muted-foreground space-y-0.5">
        {rules.map((rule, idx) => (
          <div key={idx}>
            ≥ {Math.floor(rule.min_shift_minutes / 60)}h
            {rule.min_shift_minutes % 60 > 0
              ? (rule.min_shift_minutes % 60).toString().padStart(2, "0")
              : ""}{" "}
            → {rule.break_minutes} min
          </div>
        ))}
      </div>
    );
  }

  return null;
}

function getPaidBreak(policy: BreakPolicyRecord["policy_json"]): boolean | null {
  if ("paid_break" in policy) {
    return policy.paid_break as boolean;
  }
  return null;
}
export function BreakRuleList({
  policies,
  isLoading,
  onActivate,
  onDeactivate,
  onDelete,
  isActivating,
  isDeactivating,
  isDeleting,
}: BreakRuleListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (policies.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Aucune règle de pause enregistrée
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {policies.map((policy) => {
        const badgeInfo = getPolicyBadgeInfo(policy.policy_json);
        const paidBreak = getPaidBreak(policy.policy_json);
        const IconComponent = badgeInfo.icon;

        return (
          <Card
            key={policy.id}
            className={policy.is_active ? "border-primary/50 bg-primary/5" : ""}
          >
            <CardContent className="py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-sm">Version {policy.version}</span>
                    {policy.is_active && (
                      <Badge variant="default" className="text-xs">
                        ACTIVE
                      </Badge>
                    )}
                    <Badge variant={badgeInfo.variant} className="text-xs flex items-center gap-1">
                      <IconComponent className="h-3 w-3" />
                      {badgeInfo.label}
                    </Badge>
                    {paidBreak !== null && (
                      <Badge variant="outline" className="text-xs">
                        {paidBreak ? "Payée" : "Non payée"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Créée le {formatDate(policy.created_at)}
                  </p>
                  {renderPolicySummary(policy.policy_json)}
                </div>

                <div className="flex items-center gap-1">
                  {policy.is_active ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeactivate(policy.id)}
                      disabled={isDeactivating}
                      title="Désactiver"
                    >
                      {isDeactivating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <PowerOff className="h-4 w-4" />
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onActivate(policy.id)}
                      disabled={isActivating}
                      title="Activer"
                    >
                      {isActivating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Power className="h-4 w-4" />
                      )}
                    </Button>
                  )}

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        title="Supprimer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer cette règle ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Cette action est irréversible. La règle sera définitivement supprimée.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => onDelete(policy.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Supprimer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
