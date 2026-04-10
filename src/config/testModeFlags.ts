/**
 * TEST MODE FLAGS - Configuration isolée pour le mode test salariés
 *
 * ISOLATION: Ce fichier peut être supprimé en un patch pour retirer
 * complètement le mode test sans impacter les modules principaux.
 */

// Active le bouton "Créer salarié test" dans Admin → Utilisateurs
// Tied to DEV mode — disabled in production builds
export const ADMIN_TEST_MODE = import.meta.env.DEV;

// Active l'envoi d'emails pour les invitations (désactivé en dev)
export const INVITATION_EMAIL_ENABLED = !import.meta.env.DEV;
