/**
 * Notification Wizard — Types
 */

export type AlertType = "late" | "no_badge_arrival" | "no_badge_departure";
export type NoBadgeSubType = "arrival" | "departure" | "both";

export interface RoleStrategy {
  roleId: string;
  roleName: string;
  /** Minutes before first alert (empty string = not set) */
  delayMinutes: number | "";
  /** Body for the initial alert */
  initialMessageBody: string;
  /** Include employee name automatically (only for non-employee roles) */
  includeEmployeeName: boolean;
  /** Enable automatic reminders */
  remindersEnabled: boolean;
  /** Minutes between reminders */
  reminderIntervalMinutes: number | "";
  /** Max reminder count */
  maxReminders: number | "";
  /** Body for standard reminders */
  reminderMessageBody: string;
  /** Use specific message for last reminder */
  finalReminderEnabled: boolean;
  /** Body for last reminder */
  finalReminderBody: string;
  /** Title template for this role */
  titleTemplate: string;
}

export interface WizardState {
  alertType: AlertType;
  noBadgeSubType: NoBadgeSubType;
  selectedRoleIds: string[];
  strategies: Record<string, RoleStrategy>;
}

export interface Role {
  id: string;
  name: string;
}

export const ALERT_TYPE_META: Record<AlertType, { label: string; description: string; emoji: string }> = {
  late: {
    label: "Retard à l'arrivée",
    description: "Le salarié badge après le début de son shift.",
    emoji: "⏰",
  },
  no_badge_arrival: {
    label: "Ne badge pas — Arrivée",
    description: "Le salarié ne badge pas son arrivée au début du shift.",
    emoji: "🚫",
  },
  no_badge_departure: {
    label: "Ne badge pas — Sortie",
    description: "Le salarié ne badge pas sa sortie à la fin du shift.",
    emoji: "🚪",
  },
};

export function createEmptyWizardState(): WizardState {
  return {
    alertType: "late",
    noBadgeSubType: "arrival",
    selectedRoleIds: [],
    strategies: {},
  };
}

const DEFAULT_TITLES: Record<AlertType, string> = {
  late: "⏰ Retard détecté",
  no_badge_arrival: "🚫 Badge arrivée manquant",
  no_badge_departure: "🚪 Badge sortie manquant",
};

export function getDefaultStrategy(roleId: string, roleName: string, alertType?: AlertType): RoleStrategy {
  return {
    roleId,
    roleName,
    delayMinutes: "",
    initialMessageBody: "",
    includeEmployeeName: false,
    remindersEnabled: false,
    reminderIntervalMinutes: "",
    maxReminders: "",
    reminderMessageBody: "",
    finalReminderEnabled: false,
    finalReminderBody: "",
    titleTemplate: DEFAULT_TITLES[alertType ?? "late"],
  };
}
