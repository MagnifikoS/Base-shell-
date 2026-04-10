import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Establishment {
  id: string;
  name: string;
  status: "active" | "archived";
  organization_id: string;
  /** Establishment type (restaurant, fournisseur, etc.) */
  establishment_type?: string;
  /** Trade name for anti-collision (supplier vs recipient) */
  trade_name?: string | null;
  /** Address for anti-collision */
  address?: string | null;
  /** Contact email for anti-collision */
  contact_email?: string | null;
}

interface EstablishmentContextType {
  /** All establishments fetched (for internal use - prefer useEstablishmentAccess for filtered list) */
  establishments: Establishment[];
  activeEstablishment: Establishment | null;
  setActiveEstablishment: (establishment: Establishment) => void;
  loading: boolean;
  refreshEstablishments: () => Promise<void>;
  /** Reset active establishment for admin session (forces re-selection) */
  resetForAdminSession: () => void;
}

const EstablishmentContext = createContext<EstablishmentContextType | undefined>(undefined);

const STORAGE_KEY = "active_establishment_id";

export function EstablishmentProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [activeEstablishment, setActiveEstablishmentState] = useState<Establishment | null>(null);
  const [loading, setLoading] = useState(true);

  // Track if admin session reset has been triggered (blocks auto-restore)
  const adminSessionResetRef = useRef(false);

  // Fetch establishments logic (extracted for reuse)
  // NOTE: This fetches ALL active establishments for the org (via RLS).
  // Filtering by user_establishments is done in useEstablishmentAccess hook.
  const fetchEstablishments = useCallback(async () => {
    if (!user) {
      setEstablishments([]);
      setActiveEstablishmentState(null);
      adminSessionResetRef.current = false;
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("establishments")
        .select("id, name, status, organization_id, establishment_type, trade_name, address, contact_email")
        .eq("status", "active")
        .order("name", { ascending: true });

      if (error) {
        setEstablishments([]);
        setLoading(false);
        return;
      }

      const fetchedEstablishments = (data || []) as Establishment[];
      setEstablishments(fetchedEstablishments);

      // If admin reset was triggered, do NOT auto-restore
      if (adminSessionResetRef.current) {
        // Keep activeEstablishment null, Gate will handle display
        setActiveEstablishmentState(null);
        setLoading(false);
        return;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // SSOT: Validate activeEstablishment against RLS-fetched list (not V2)
      // ═══════════════════════════════════════════════════════════════════════
      // CRITICAL FIX: This breaks the circular dependency where:
      //   - useEstablishmentAccess depended on V2's establishmentIds
      //   - V2 depended on activeEstablishment
      //   - If activeEstablishment was out of scope → V2 returned [] → no correction
      //
      // Now: EstablishmentContext validates localStorage against RLS list BEFORE
      // any V2 call. activeEstablishment is always valid when V2 fires.
      // ═══════════════════════════════════════════════════════════════════════
      if (fetchedEstablishments.length === 0) {
        setActiveEstablishmentState(null);
        // Clear stale localStorage if no establishments accessible
        localStorage.removeItem(STORAGE_KEY);
      } else if (fetchedEstablishments.length === 1) {
        setActiveEstablishmentState(fetchedEstablishments[0]);
        localStorage.setItem(STORAGE_KEY, fetchedEstablishments[0].id);
      } else {
        const savedId = localStorage.getItem(STORAGE_KEY);
        const savedEstablishment = savedId
          ? fetchedEstablishments.find((e) => e.id === savedId)
          : null;

        if (savedEstablishment) {
          // Saved ID is valid and in the fetched list → use it
          setActiveEstablishmentState(savedEstablishment);
        } else {
          // ═══════════════════════════════════════════════════════════════════
          // AUTO-CORRECTION: savedId is null, empty, or NOT in RLS list
          // ═══════════════════════════════════════════════════════════════════
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.log(
              `[ESTABLISHMENT_CONTEXT] Auto-correction: localStorage="${savedId}" not in RLS list [${fetchedEstablishments.map((e) => e.id).join(", ")}]. Falling back to first.`
            );
          }
          setActiveEstablishmentState(fetchedEstablishments[0]);
          localStorage.setItem(STORAGE_KEY, fetchedEstablishments[0].id);
        }
      }
    } catch {
      setEstablishments([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Initial fetch on user change
  useEffect(() => {
    // Reset admin flag on user change (new session)
    adminSessionResetRef.current = false;
    fetchEstablishments();
  }, [fetchEstablishments]);

  // Exposed refresh method (stable)
  const refreshEstablishments = useCallback(async () => {
    await fetchEstablishments();
  }, [fetchEstablishments]);

  const setActiveEstablishment = useCallback((establishment: Establishment) => {
    setActiveEstablishmentState(establishment);
    localStorage.setItem(STORAGE_KEY, establishment.id);
  }, []);

  /**
   * Reset for admin session: clears active establishment and blocks auto-restore.
   * Called by AdminEstablishmentGate at mount to force re-selection.
   * Pure action, no UX logic - Gate decides when/how to use this.
   */
  const resetForAdminSession = useCallback(() => {
    adminSessionResetRef.current = true;
    setActiveEstablishmentState(null);
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({
      establishments,
      activeEstablishment,
      setActiveEstablishment,
      loading,
      refreshEstablishments,
      resetForAdminSession,
    }),
    [
      establishments,
      activeEstablishment,
      setActiveEstablishment,
      loading,
      refreshEstablishments,
      resetForAdminSession,
    ]
  );

  return (
    <EstablishmentContext.Provider value={contextValue}>{children}</EstablishmentContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useEstablishment() {
  const context = useContext(EstablishmentContext);
  if (context === undefined) {
    throw new Error("useEstablishment must be used within an EstablishmentProvider");
  }
  return context;
}
