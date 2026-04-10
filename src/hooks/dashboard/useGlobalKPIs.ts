/**
 * useGlobalKPIs — Platform-wide metrics for the Global Dashboard (admin-only).
 *
 * Fetches organizations, establishments, and profiles using the admin user's
 * JWT. If RLS blocks access, results are limited to what the user
 * can see — the UI handles partial data gracefully.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ── Types ──────────────────────────────────────────────────────────────

export interface OrganizationOverview {
  id: string;
  name: string;
  establishmentCount: number;
  activeEstablishmentCount: number;
  userCount: number;
  activeUserCount: number;
  createdAt: string;
}

export interface GlobalKPIs {
  totalOrganizations: number;
  totalEstablishments: number;
  totalActiveEstablishments: number;
  totalUsers: number;
  totalActiveUsers: number;
  organizations: OrganizationOverview[];
  newOrgsThisMonth: number;
  newUsersThisMonth: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

function getMonthStart(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01T00:00:00`;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useGlobalKPIs(enabled: boolean) {
  const { user } = useAuth();

  return useQuery<GlobalKPIs>({
    queryKey: ["global-kpis", user?.id],
    enabled: enabled && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<GlobalKPIs> => {
      // 1. Fetch all organizations
      const { data: orgs, error: orgsErr } = await supabase
        .from("organizations")
        .select("id, name, created_at")
        .order("created_at", { ascending: false });

      if (orgsErr) throw orgsErr;
      const organizations = orgs ?? [];

      // 2. Fetch all establishments (id, org, status)
      const { data: estabs, error: estabsErr } = await supabase
        .from("establishments")
        .select("id, organization_id, status, created_at");

      if (estabsErr) throw estabsErr;
      const establishments = estabs ?? [];

      // 3. Fetch all profiles (id, org, status)
      const { data: profs, error: profsErr } = await supabase
        .from("profiles")
        .select("id, organization_id, status, created_at");

      if (profsErr) throw profsErr;
      const profiles = profs ?? [];

      // ── Aggregate per-org ────────────────────────────────────────

      const estabByOrg = new Map<string, typeof establishments>();
      for (const e of establishments) {
        const list = estabByOrg.get(e.organization_id) ?? [];
        list.push(e);
        estabByOrg.set(e.organization_id, list);
      }

      const profByOrg = new Map<string, typeof profiles>();
      for (const p of profiles) {
        const list = profByOrg.get(p.organization_id) ?? [];
        list.push(p);
        profByOrg.set(p.organization_id, list);
      }

      const orgOverviews: OrganizationOverview[] = organizations.map((org) => {
        const orgEstabs = estabByOrg.get(org.id) ?? [];
        const orgProfs = profByOrg.get(org.id) ?? [];
        return {
          id: org.id,
          name: org.name,
          establishmentCount: orgEstabs.length,
          activeEstablishmentCount: orgEstabs.filter((e) => e.status === "active").length,
          userCount: orgProfs.length,
          activeUserCount: orgProfs.filter((p) => p.status === "active").length,
          createdAt: org.created_at,
        };
      });

      // ── Platform totals ──────────────────────────────────────────

      const monthStart = getMonthStart();

      return {
        totalOrganizations: organizations.length,
        totalEstablishments: establishments.length,
        totalActiveEstablishments: establishments.filter((e) => e.status === "active").length,
        totalUsers: profiles.length,
        totalActiveUsers: profiles.filter((p) => p.status === "active").length,
        organizations: orgOverviews,
        newOrgsThisMonth: organizations.filter((o) => o.created_at >= monthStart).length,
        newUsersThisMonth: profiles.filter((p) => p.created_at >= monthStart).length,
      };
    },
  });
}
