/**
 * ROLES UTILS - Source unique pour les règles d'assignabilité des rôles
 * 
 * Le rôle "Autres" est un placeholder système qui ne doit jamais être assigné à un salarié.
 * Cette logique est centralisée ici pour éviter les doublons.
 */

// Nom du rôle système non-assignable
export const NON_ASSIGNABLE_ROLE_NAME = "Autres";

// Liste des noms de rôles système assignables (pour référence)
export const SYSTEM_ASSIGNABLE_ROLES = [
  "Administrateur",
  "Super Admin",
  "Directeur",
  "Salarié",
  "Caissier",
];

/**
 * Vérifie si un rôle est assignable à un salarié
 * @param roleName - Le nom du rôle
 * @returns true si le rôle peut être assigné
 */
export function isRoleAssignable(roleName: string): boolean {
  return roleName !== NON_ASSIGNABLE_ROLE_NAME;
}

/**
 * Filtre une liste de rôles pour ne garder que les assignables
 * @param roles - Liste de rôles avec au moins une propriété "name"
 * @returns Liste filtrée sans le rôle "Autres"
 */
export function filterAssignableRoles<T extends { name: string }>(roles: T[]): T[] {
  return roles.filter((role) => isRoleAssignable(role.name));
}
