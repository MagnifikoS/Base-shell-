import { User } from "@supabase/supabase-js";

interface UserSessionTagProps {
  user: User | null;
  onClick?: () => void;
}

/**
 * Extracts user initials from available user data.
 * Priority: full_name > email prefix > "??"
 */
function getInitials(user: User | null): string {
  if (!user) return "??";

  // Priority 1: full_name from user metadata
  const fullName = user.user_metadata?.full_name as string | undefined;
  if (fullName && fullName.trim()) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return fullName.slice(0, 2).toUpperCase();
  }

  // Priority 2: email prefix (before @)
  const email = user.email;
  if (email) {
    const prefix = email.split("@")[0];
    if (prefix.length >= 2) {
      return prefix.slice(0, 2).toUpperCase();
    }
    return prefix.toUpperCase() || "??";
  }

  // Fallback
  return "??";
}

/**
 * Pure UI component displaying user initials as a clickable button.
 * Blue background, white text. Triggers onClick (logout) when clicked.
 */
export function UserSessionTag({ user, onClick }: UserSessionTagProps) {
  const initials = getInitials(user);

  return (
    <div className="flex items-center justify-center py-3">
      <button
        type="button"
        onClick={onClick}
        className="w-10 h-10 rounded-full bg-primary flex items-center justify-center cursor-pointer hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
        title="Déconnexion"
        aria-label="Déconnexion"
      >
        <span className="text-sm font-semibold text-primary-foreground">{initials}</span>
      </button>
    </div>
  );
}
