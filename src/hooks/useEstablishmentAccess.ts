/**
 * useEstablishmentAccess
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CANONICAL SOURCE OF TRUTH — LIGNE DROITE ARCHITECTURE (V2 FIX)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * OFFICIAL API for reading the active establishment.
 *
 * SOURCE CANONIQUE UNIQUE:
 *   EstablishmentContext.activeEstablishment (validated against RLS list)
 *
 * RÈGLES (POST-FIX):
 *   - accessibleEstablishments = establishments from Context (RLS-based)
 *     → For non-admins: filtered by user_establishments assignments
 *     → For admins: all active establishments (org-wide)
 *   - showSelector = accessibleEstablishments.length > 1
 *   - If non-admin has exactly 1 assigned establishment → auto-select, no selector
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useEffect } from "react";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface Establishment {
  id: string;
  name: string;
  status: "active" | "archived";
  organization_id: string;
  establishment_type?: string;
}

export interface EstablishmentAccessResult {
  /** Establishments the user can access (from RLS, not V2) */
  accessibleEstablishments: Establishment[];
  /** Whether to show the establishment selector (>1 accessible) */
  showSelector: boolean;
  /** Currently active establishment ID */
  activeEstablishmentId: string | null;
  /** Currently active establishment object */
  activeEstablishment: Establishment | null;
  /** Set the active establishment */
  setActiveEstablishment: (establishment: Establishment) => void;
  /** Loading state */
  loading: boolean;
  /** Permissions loading state */
  permissionsLoading: boolean;
}

export function useEstablishmentAccess(): EstablishmentAccessResult {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const {
    establishments,
    activeEstablishment,
    setActiveEstablishment: setContextActiveEstablishment,
    loading: contextLoading,
  } = useEstablishment();

  const { isAdmin, isLoading: permissionsLoading } = usePermissions();

  // ═══════════════════════════════════════════════════════════════════════════
  // Fetch user_establishments assignments for non-admin users
  // ═══════════════════════════════════════════════════════════════════════════
  const { data: userEstablishmentIds } = useQuery({
    queryKey: ["user-establishments", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_establishments")
        .select("establishment_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data || []).map((row) => row.establishment_id);
    },
    enabled: !!user && !isAdmin && !permissionsLoading,
    staleTime: 5 * 60 * 1000, // 5 min cache
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Filter accessible establishments
  // - Admin: all active establishments (org-wide via RLS)
  // - Non-admin: only establishments they are assigned to via user_establishments
  // ═══════════════════════════════════════════════════════════════════════════
  const accessibleEstablishments = useMemo(() => {
    const active = establishments.filter((e) => e.status === "active");

    // Admin or permissions still loading → show all from RLS
    if (isAdmin || permissionsLoading) return active;

    // Non-admin: filter by user_establishments
    if (!userEstablishmentIds) return active; // Still loading assignments → show all temporarily
    return active.filter((e) => userEstablishmentIds.includes(e.id));
  }, [establishments, isAdmin, permissionsLoading, userEstablishmentIds]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Auto-select if non-admin has exactly 1 accessible establishment
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (permissionsLoading || isAdmin || contextLoading) return;
    if (accessibleEstablishments.length === 1) {
      const sole = accessibleEstablishments[0];
      if (activeEstablishment?.id !== sole.id) {
        setContextActiveEstablishment(sole);
      }
    }
  }, [accessibleEstablishments, isAdmin, permissionsLoading, contextLoading, activeEstablishment, setContextActiveEstablishment]);

  // Show selector if user has access to more than one establishment
  const showSelector = accessibleEstablishments.length > 1;

  // Wrap setActiveEstablishment to invalidate relevant caches
  const setActiveEstablishment = (establishment: Establishment) => {
    if (establishment.id === activeEstablishment?.id) return;

    // 1. Update canonical source (Context)
    setContextActiveEstablishment(establishment);

    // 2. Invalidate permissions cache FIRST (new establishment = new permissions)
    queryClient.invalidateQueries({ queryKey: ["my-permissions-v2"], exact: false });

    // 3. Invalidate establishment-scoped queries
    queryClient.invalidateQueries({ queryKey: ["planning-week", establishment.id], exact: false });
    queryClient.invalidateQueries({ queryKey: ["presence"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["employees"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["employees-mobile"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["alerts"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["absence"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["late"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["extras"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["badge-status"], exact: false });

    // PER-DIR-004: Invalidate stock, BL-App, invoices, products, payroll, cash, vision-AI
    queryClient.invalidateQueries({ queryKey: ["stock-documents-history"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["stock-documents-draft"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["stock-alerts"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["bl-app"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["invoices"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["products-v2"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["product-v2"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["desktop-stock"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["payroll"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["cash-day"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["vision-ai"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["establishment-kpis"], exact: false });

    // DEV log
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log(
        `[ESTABLISHMENT_ACCESS] Switched to: ${establishment.id} (${establishment.name})`
      );
    }
  };

  return {
    accessibleEstablishments,
    showSelector,
    activeEstablishmentId: activeEstablishment?.id ?? null,
    activeEstablishment,
    setActiveEstablishment,
    loading: contextLoading,
    permissionsLoading,
  };
}
