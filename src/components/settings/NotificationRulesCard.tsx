/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTIFICATION RULES — Premium wizard-based CRUD for notification_rules
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Clock,
  Ban,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";
import {
  WizardModal,
  DeleteRuleDialog,
  ALERT_TYPE_META,
  getDefaultStrategy,
  type WizardState,
  type Role,
} from "./notification-wizard";

interface NotificationRule {
  id: string;
  establishment_id: string;
  organization_id: string;
  alert_type: string;
  category: string;
  enabled: boolean;
  min_severity: number;
  cooldown_minutes: number;
  recipient_role_ids: string[];
  title_template: string;
  body_template: string;
  active_start_time: string;
  active_end_time: string;
  config: Record<string, unknown>;
  scope: string;
  priority: number;
  created_at: string;
  updated_at: string;
}

const ALERT_ICONS: Record<string, typeof Clock> = {
  late: Clock,
  no_badge_arrival: Ban,
  no_badge_departure: AlertTriangle,
};

/** Check if a rule has complete per-role SSOT config — including reminder fields */
function isRuleConfigComplete(rule: NotificationRule): boolean {
  const config = (rule.config ?? {}) as Record<string, unknown>;
  for (const roleId of rule.recipient_role_ids) {
    const rc = (config[`role_${roleId}`] as Record<string, unknown>) ?? {};
    if (!rc.initialMessageBody || !(rc.initialMessageBody as string).trim()) return false;
    if (typeof rc.delayMinutes !== "number") return false;
    // Validate reminder fields if enabled
    if (rc.remindersEnabled === true) {
      if (typeof rc.reminderIntervalMinutes !== "number" || (rc.reminderIntervalMinutes as number) < 1) return false;
      if (typeof rc.maxReminders !== "number" || (rc.maxReminders as number) < 1) return false;
      if (!rc.reminderMessageBody || !(rc.reminderMessageBody as string).trim()) return false;
      if (rc.finalReminderEnabled === true) {
        if (!rc.finalReminderBody || !(rc.finalReminderBody as string).trim()) return false;
      }
    }
  }
  return true;
}

/** Build a human-readable summary for a rule card — SSOT: reads from config JSON only */
function buildRuleSummary(rule: NotificationRule, roles: Role[]): string {
  const meta = ALERT_TYPE_META[rule.alert_type as keyof typeof ALERT_TYPE_META];
  const label = meta?.label ?? rule.alert_type;
  const config = (rule.config ?? {}) as Record<string, unknown>;
  const roleNames = rule.recipient_role_ids
    .map((id) => roles.find((r) => r.id === id)?.name ?? "Inconnu")
    .join(", ");

  const parts: string[] = [];
  parts.push(`Si un salarié est en situation de ${label.toLowerCase()},`);

  if (roleNames) {
    // Use MIN delay across all roles from config SSOT
    const delays = rule.recipient_role_ids.map((id) => {
      const rc = (config[`role_${id}`] as Record<string, unknown>) ?? {};
      return typeof rc.delayMinutes === "number" ? rc.delayMinutes : null;
    }).filter((d): d is number => d !== null);
    const minDelay = delays.length > 0 ? Math.min(...delays) : null;
    if (minDelay !== null) {
      parts.push(`${roleNames} sera notifié après ${minDelay} min.`);
    } else {
      parts.push(`${roleNames} sera notifié.`);
    }
  }

  // Check if any role has reminders enabled from config SSOT
  const reminderRoles = rule.recipient_role_ids.filter((id) => {
    const rc = (config[`role_${id}`] as Record<string, unknown>) ?? {};
    return rc.remindersEnabled === true;
  });
  if (reminderRoles.length > 0) {
    // Show interval + max from first role with reminders
    const rc = (config[`role_${reminderRoles[0]}`] as Record<string, unknown>) ?? {};
    const interval = rc.reminderIntervalMinutes as number;
    const max = rc.maxReminders as number;
    if (typeof interval === "number" && typeof max === "number") {
      parts.push(`Rappels : toutes les ${interval} min, max ${max}.`);
    } else {
      parts.push("Rappels automatiques activés.");
    }
  }

  return parts.join("\n");
}

/** Convert a DB rule to a WizardState (for editing) */
function ruleToWizardState(rule: NotificationRule, roles: Role[]): WizardState {
  const alertType = rule.alert_type as WizardState["alertType"];
  const config = (rule.config ?? {}) as Record<string, unknown>;

  const selectedRoleIds = rule.recipient_role_ids ?? [];
  const strategies: WizardState["strategies"] = {};

  for (const roleId of selectedRoleIds) {
    const role = roles.find((r) => r.id === roleId);
    const roleName = role?.name ?? roleId;

    // ═══ SSOT: All values come EXCLUSIVELY from config.role_{id} — NO fallback to global columns ═══
    const roleConfig = (config[`role_${roleId}`] as Record<string, unknown>) ?? {};

    strategies[roleId] = {
      roleId,
      roleName,
      delayMinutes: (roleConfig.delayMinutes as number) ?? "",
      initialMessageBody: (roleConfig.initialMessageBody as string) ?? "",
      includeEmployeeName: (roleConfig.includeEmployeeName as boolean) ?? false,
      remindersEnabled: (roleConfig.remindersEnabled as boolean) ?? false,
      reminderIntervalMinutes: (roleConfig.reminderIntervalMinutes as number) ?? "",
      maxReminders: (roleConfig.maxReminders as number) ?? "",
      reminderMessageBody: (roleConfig.reminderMessageBody as string) ?? "",
      finalReminderEnabled: (roleConfig.finalReminderEnabled as boolean) ?? false,
      finalReminderBody: (roleConfig.finalReminderBody as string) ?? "",
      titleTemplate: (roleConfig.titleTemplate as string) ?? "",
    };
  }

  return {
    alertType,
    noBadgeSubType: (config.noBadgeSubType as WizardState["noBadgeSubType"]) ?? "arrival",
    selectedRoleIds,
    strategies,
  };
}

export function NotificationRulesCard() {
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<NotificationRule | null>(null);
  const [editWizardState, setEditWizardState] = useState<WizardState | null>(null);
  const [startAtSummary, setStartAtSummary] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const establishmentId = activeEstablishment?.id;
  const organizationId = activeEstablishment?.organization_id;

  // ═══ Fetch rules ═══
  const { data: rules, isLoading } = useQuery({
    queryKey: ["notification-rules", establishmentId],
    queryFn: async () => {
      if (!establishmentId) return [];
      const { data, error } = await supabase
        .from("notification_rules")
        .select("*")
        .eq("establishment_id", establishmentId)
        .eq("category", "badgeuse")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as NotificationRule[];
    },
    enabled: !!establishmentId,
  });

  // ═══ Fetch roles ═══
  const { data: roles } = useQuery({
    queryKey: ["roles-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roles")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Role[];
    },
  });

  // ═══ Toggle enabled ═══
  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("notification_rules")
        .update({ enabled })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-rules", establishmentId] });
    },
    onError: (err) => toast.error(`Erreur : ${(err as Error).message}`),
  });

  // ═══ Save wizard — serializes ONLY engine-read fields ═══
  const handleWizardSave = async (wizardState: WizardState) => {
    if (!establishmentId || !organizationId) throw new Error("Pas d'établissement");

    const firstRoleId = wizardState.selectedRoleIds[0];
    const firstStrategy = wizardState.strategies[firstRoleId];

    // Build per-role config — ONLY fields read by the engine
    const perRoleConfig: Record<string, unknown> = {
      noBadgeSubType: wizardState.noBadgeSubType,
    };
    for (const roleId of wizardState.selectedRoleIds) {
      const s = wizardState.strategies[roleId];
      perRoleConfig[`role_${roleId}`] = {
        delayMinutes: s?.delayMinutes ?? 5,
        initialMessageBody: s?.initialMessageBody ?? "",
        includeEmployeeName: s?.includeEmployeeName ?? false,
        remindersEnabled: s?.remindersEnabled ?? false,
        reminderIntervalMinutes: s?.reminderIntervalMinutes ?? 5,
        maxReminders: s?.maxReminders ?? 3,
        reminderMessageBody: s?.reminderMessageBody ?? "",
        finalReminderEnabled: s?.finalReminderEnabled ?? false,
        finalReminderBody: s?.finalReminderBody ?? "",
        titleTemplate: s?.titleTemplate ?? "",
      };
    }

    const payload = {
      establishment_id: establishmentId,
      organization_id: organizationId,
      alert_type: wizardState.alertType,
      category: "badgeuse" as const,
      enabled: true,
      min_severity: typeof firstStrategy?.delayMinutes === "number" ? firstStrategy.delayMinutes : 5,
      cooldown_minutes: firstStrategy?.remindersEnabled && typeof firstStrategy.reminderIntervalMinutes === "number"
        ? firstStrategy.reminderIntervalMinutes
        : 0,
      recipient_role_ids: wizardState.selectedRoleIds,
      title_template: firstStrategy?.titleTemplate ?? "",
      body_template: firstStrategy?.initialMessageBody ?? "",
      active_start_time: "00:00",
      active_end_time: "23:59",
      config: perRoleConfig as Record<string, string>,
    };

    if (editingRule) {
      const { error } = await supabase
        .from("notification_rules")
        .update(payload)
        .eq("id", editingRule.id);
      if (error) throw error;
      toast.success("Règle modifiée");
    } else {
      const { error } = await supabase
        .from("notification_rules")
        .insert(payload);
      if (error) throw error;
      toast.success("Règle créée");
    }

    queryClient.invalidateQueries({ queryKey: ["notification-rules", establishmentId] });
    setEditingRule(null);
    setEditWizardState(null);
  };

  // ═══ Delete ═══
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notification_rules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-rules", establishmentId] });
      toast.success("Règle supprimée");
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(`Erreur : ${(err as Error).message}`),
  });

  const openCreate = () => {
    setEditingRule(null);
    setEditWizardState(null);
    setStartAtSummary(false);
    setWizardOpen(true);
  };

  const openEdit = (rule: NotificationRule) => {
    setEditingRule(rule);
    setEditWizardState(ruleToWizardState(rule, roles ?? []));
    setStartAtSummary(true);
    setWizardOpen(true);
  };

  if (!establishmentId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Règles d'alertes automatiques
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sélectionnez un établissement pour gérer les règles.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4" />
                Règles d'alertes automatiques
              </CardTitle>
              <CardDescription>
                Configurez les alertes push pour retards, arrivées non badgées et oublis de sortie.
              </CardDescription>
            </div>
            <Button size="sm" onClick={openCreate} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Ajouter une règle
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement…
            </div>
          ) : !rules || rules.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <Bell className="h-8 w-8 mx-auto text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Aucune règle configurée.
              </p>
              <p className="text-xs text-muted-foreground">
                Créez une première règle pour recevoir des alertes automatiques.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => {
                const meta = ALERT_TYPE_META[rule.alert_type as keyof typeof ALERT_TYPE_META];
                const Icon = ALERT_ICONS[rule.alert_type] ?? Bell;
                const summary = buildRuleSummary(rule, roles ?? []);
                const complete = isRuleConfigComplete(rule);
                return (
                  <div
                    key={rule.id}
                    className="group rounded-xl border p-4 hover:shadow-sm transition-shadow cursor-pointer"
                    onClick={() => openEdit(rule)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">
                            {meta?.label ?? rule.alert_type}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line leading-relaxed">
                            {summary}
                          </p>
                          {!complete && (
                            <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3" />
                              <span>Règle incomplète — ouvrez pour compléter la configuration</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({ id: rule.id, enabled: checked })
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(rule);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(rule.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wizard Modal */}
      <WizardModal
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        roles={roles ?? []}
        onSave={handleWizardSave}
        initialState={editWizardState}
        startAtSummary={startAtSummary}
      />

      {/* Delete confirmation */}
      <DeleteRuleDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        isPending={deleteMutation.isPending}
      />
    </>
  );
}
