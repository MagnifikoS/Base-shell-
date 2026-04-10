import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { User, Session } from "@supabase/supabase-js";
import { setUser as sentrySetUser } from "@/lib/sentry";
import { supabase } from "@/integrations/supabase/client";
import { queryClient } from "@/lib/queryClient";

// Admin gate session key - must match AdminEstablishmentGate
const ADMIN_GATE_RESET_KEY = "admin_gate_reset_done";

/**
 * Clear admin session flags from sessionStorage
 * Called on sign out to ensure fresh state on next login
 */
function clearAdminSessionFlags(): void {
  try {
    sessionStorage.removeItem(ADMIN_GATE_RESET_KEY);
  } catch {
    // sessionStorage unavailable, no-op
  }
}

/**
 * Clear establishment-related localStorage items on sign out
 * Prevents stale data from leaking between sessions
 */
function clearEstablishmentStorage(): void {
  try {
    localStorage.removeItem("active_establishment_id");
  } catch {
    // localStorage unavailable, no-op
  }
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up auth state listener BEFORE checking session
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      // Always reflect the current session state
      setSession(newSession);
      setUser(newSession?.user ?? null);

      // Sentry user context — only id + email, no other PII
      if (newSession?.user) {
        sentrySetUser({ id: newSession.user.id, email: newSession.user.email });
      } else {
        sentrySetUser(null);
      }

      // Handle session loss: clear cache, admin flags, and establishment data
      if (newSession === null) {
        queryClient.clear();
        clearAdminSessionFlags();
        clearEstablishmentStorage();
        // SmartHomeRedirect will handle navigation to /auth
      }

      setLoading(false);
    });

    // Check initial session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    clearAdminSessionFlags();
    clearEstablishmentStorage();
    sentrySetUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, session, loading, signOut }),
    [user, session, loading, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
