/**
 * Shared types and helper functions for the Users Manager.
 */

export interface Role {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
}

export interface Establishment {
  id: string;
  name: string;
}

export interface User {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  status: string;
  created_at: string;
  roles: Role[];
  teams: Team[];
  establishments: Establishment[];
}

export const STATUS_OPTIONS = [
  { value: "all", label: "Tous" },
  { value: "requested", label: "Demandes" },
  { value: "active", label: "Actifs" },
  { value: "disabled", label: "Désactivés" },
  { value: "rejected", label: "Refusés" },
];

export const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export function getActionDialogContent(confirmAction: { type: string; user: User } | null) {
  if (!confirmAction) return { title: "", description: "" };

  const { type, user } = confirmAction;
  const name = user.full_name || user.email;

  switch (type) {
    case "accept":
      return {
        title: "Accepter l'utilisateur",
        description: `Voulez-vous accepter ${name} ? L'utilisateur pourra accéder à l'application.`,
      };
    case "reject":
      return {
        title: "Refuser l'utilisateur",
        description: `Voulez-vous refuser ${name} ? L'utilisateur ne pourra pas accéder à l'application.`,
      };
    case "disable":
      return {
        title: "Désactiver l'utilisateur",
        description: `Voulez-vous désactiver ${name} ? L'utilisateur ne pourra plus accéder à l'application.`,
      };
    case "reactivate":
      return {
        title: "Réactiver l'utilisateur",
        description: `Voulez-vous réactiver ${name} ? L'utilisateur pourra à nouveau accéder à l'application.`,
      };
    default:
      return { title: "", description: "" };
  }
}
