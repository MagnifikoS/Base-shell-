/**
 * AdminEstablishmentGate
 *
 * Gate component for mobile admin: forces establishment selection
 * before any module/data is accessible.
 *
 * RULES:
 * - Only affects admin users on mobile
 * - Calls resetForAdminSession() on mount to clear any persisted selection
 * - Blocks children until establishment is selected
 * - Does NOT contain any business logic beyond selection
 * - Reset survives page refresh (sessionStorage) but clears on sign out
 */

import { useEffect, useRef } from "react";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { MobileLayout } from "../MobileLayout";
import { Building2, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Session storage key for tracking reset state
export const ADMIN_GATE_RESET_KEY = "admin_gate_reset_done";

/**
 * Safe sessionStorage access with fallback
 * Returns null if sessionStorage is unavailable (privacy mode, etc.)
 */
function safeGetSessionFlag(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetSessionFlag(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

interface AdminEstablishmentGateProps {
  children: React.ReactNode;
}

export function AdminEstablishmentGate({ children }: AdminEstablishmentGateProps) {
  const { user } = useAuth();
  const {
    establishments,
    activeEstablishment,
    setActiveEstablishment,
    loading,
    resetForAdminSession,
  } = useEstablishment();

  // Fallback ref if sessionStorage is unavailable
  const hasResetRef = useRef(false);
  // Track user ID to detect user change
  const lastUserIdRef = useRef<string | null>(null);
  // Track if initial fetch has completed at least once (prevents flash)
  const hasFetchedOnceRef = useRef(false);

  // Mark that we have fetched once when loading transitions to false with data
  useEffect(() => {
    if (!loading && establishments.length > 0) {
      hasFetchedOnceRef.current = true;
    }
  }, [loading, establishments.length]);

  useEffect(() => {
    const currentUserId = user?.id ?? null;

    // If user changed (including logout → login), clear the flag
    if (lastUserIdRef.current !== null && lastUserIdRef.current !== currentUserId) {
      hasResetRef.current = false;
      hasFetchedOnceRef.current = false;
      // Note: sessionStorage is cleared in AuthContext on sign out
    }
    lastUserIdRef.current = currentUserId;

    // Check sessionStorage first, fallback to ref
    const alreadyReset = safeGetSessionFlag(ADMIN_GATE_RESET_KEY);

    if (!alreadyReset && !hasResetRef.current) {
      // Mark as reset in both storage mechanisms
      const stored = safeSetSessionFlag(ADMIN_GATE_RESET_KEY, "true");
      if (!stored) {
        // sessionStorage unavailable, use ref as fallback
        hasResetRef.current = true;
      }
      resetForAdminSession();
    }
  }, [resetForAdminSession, user?.id]);

  // ═══════════════════════════════════════════════════════════════════════════
  // LOADING STATE — Show loader while context is resolving
  // ALSO show loader if we haven't fetched successfully at least once yet
  // This prevents flash of "Aucun établissement" during initial hydration
  // ROLLBACK: git revert of this commit
  // ═══════════════════════════════════════════════════════════════════════════
  if (loading || (!hasFetchedOnceRef.current && establishments.length === 0)) {
    return (
      <MobileLayout hideBottomNav>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MobileLayout>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NO ESTABLISHMENTS — Only show "Aucun établissement" if:
  // 1. loading is definitively false
  // 2. establishments array is empty
  // 3. user is authenticated (avoid flash during logout)
  // This is the DEFINITIVE "no access" state for users without any establishment
  // ═══════════════════════════════════════════════════════════════════════════
  if (establishments.length === 0 && user) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[AdminEstablishmentGate] No establishments → showing error (final)");
    }
    return (
      <MobileLayout hideBottomNav>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">Aucun établissement</h2>
          <p className="text-sm text-muted-foreground">
            Aucun établissement actif n'est disponible pour votre compte.
          </p>
        </div>
      </MobileLayout>
    );
  }

  // Auto-select if only one establishment (skip selection screen)
  if (!activeEstablishment && establishments.length === 1) {
    // Set it immediately — will re-render with activeEstablishment set
    setActiveEstablishment(establishments[0]);
    return (
      <MobileLayout hideBottomNav>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MobileLayout>
    );
  }

  // Gate logic: must select if no active establishment (Gate decides, not Context)
  if (!activeEstablishment) {
    return (
      <MobileLayout hideBottomNav>
        {/* Centrage stable: min-h garantit la hauteur, flex centre le contenu */}
        <div className="min-h-[calc(100dvh-64px)] flex flex-col items-center justify-center px-4 py-6">
          {/* Header centré */}
          <div className="text-center pb-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">Sélectionnez un établissement</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Choisissez l'établissement sur lequel vous souhaitez travailler
            </p>
          </div>

          {/* Establishment list */}
          <div className="w-full max-w-sm space-y-3">
            {establishments.map((establishment) => (
              <button
                key={establishment.id}
                onClick={() => setActiveEstablishment(establishment)}
                className={cn(
                  "w-full p-4 rounded-xl border-2 text-left transition-all",
                  "bg-card hover:bg-accent/50 active:scale-[0.98]",
                  "border-border hover:border-primary/50",
                  "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{establishment.name}</p>
                    <p className="text-xs text-muted-foreground">Établissement actif</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </MobileLayout>
    );
  }

  // Establishment selected: render children
  return <>{children}</>;
}
