/**
 * Quick synchronous check for a Supabase auth token in localStorage.
 * Used to short-circuit loading cascades for clearly non-authenticated users.
 *
 * IMPORTANT: This does NOT validate the token — it only checks existence.
 * A present but expired token will return true (safe: the normal auth flow handles it).
 * An absent token returns false → we can skip all loading checks and redirect to /auth.
 *
 * @returns true if a local session token exists, false otherwise
 */
export function hasLocalSession(): boolean {
  try {
    const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    if (!projectRef) return true; // Can't check → assume session exists → fallback to normal flow
    const key = `sb-${projectRef}-auth-token`;
    const raw = localStorage.getItem(key);
    return raw !== null && raw.length > 0;
  } catch {
    // localStorage unavailable (SSR, privacy mode, etc.) → assume session exists → normal flow
    return true;
  }
}
