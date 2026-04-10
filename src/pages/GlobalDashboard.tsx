import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { usePermissions } from "@/hooks/usePermissions";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { useGlobalKPIs } from "@/hooks/dashboard/useGlobalKPIs";
import { getTodayDateKeyParis } from "@/lib/time/dateKeyParis";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { AlertTriangle, Loader2, ShieldX, Building2, Users, Globe, TrendingUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import {
  SectionErrorBoundary,
  StatCard,
  GlobalDashboardSkeleton,
  OrgsTable,
  GrowthSummary,
} from "@/components/global-dashboard/GlobalDashboardWidgets";

/**
 * Global Dashboard — Admin-only platform-wide metrics across ALL organizations.
 * Route: /global-dashboard (wrapped in AdminGuard by AppRoutes.tsx)
 */
export default function GlobalDashboard() {
  const { isAdmin, isLoading: permLoading } = usePermissions();
  const { isPlatformAdmin } = usePlatformAdmin();
  const navigate = useNavigate();
  const { data: kpis, isLoading: kpisLoading, isError, refetch } = useGlobalKPIs(isAdmin);

  const todayKey = getTodayDateKeyParis();
  const isLoading = permLoading || kpisLoading;

  // ── Guards ──────────────────────────────────────────────────────────

  if (permLoading) {
    return (
      <ResponsiveLayout>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </ResponsiveLayout>
    );
  }

  if (!isAdmin) {
    return (
      <ResponsiveLayout>
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <ShieldX className="h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold text-foreground">Acces refuse</h1>
          <p className="text-muted-foreground text-center px-4">
            Vous devez etre administrateur pour acceder a cette page.
          </p>
        </div>
      </ResponsiveLayout>
    );
  }

  if (isLoading) {
    return (
      <ResponsiveLayout>
        <GlobalDashboardSkeleton />
      </ResponsiveLayout>
    );
  }

  if (isError || !kpis) {
    return (
      <ResponsiveLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Vue Globale — Restaurant OS</h1>
            <p className="text-sm text-muted-foreground">{todayKey}</p>
          </div>
          <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
            <AlertTriangle className="h-12 w-12 text-destructive" />
            <p className="text-lg font-medium text-destructive">Erreur de chargement</p>
            <p className="text-sm text-muted-foreground">
              Donnees non disponibles. Verifiez les permissions administrateur.
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Réessayer
            </Button>
          </div>
        </div>
      </ResponsiveLayout>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────

  return (
    <ResponsiveLayout>
      <div className="space-y-6">
        {/* Platform admin banner */}
        {isPlatformAdmin && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <Info className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm text-foreground">
              Vous êtes Super Admin Plateforme. Pour une vue multi-établissements, utilisez le{" "}
              <button
                onClick={() => navigate("/platform")}
                className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
              >
                Dashboard Plateforme
              </button>.
            </p>
          </div>
        )}

        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard Organisation</h1>
          <p className="text-sm text-muted-foreground">{todayKey}</p>
        </div>

        {/* Row 1: Platform KPIs (4 cards) */}
        <SectionErrorBoundary label="Indicateurs plateforme">
          <div
            className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
            role="region"
            aria-label="Indicateurs plateforme"
          >
            <StatCard
              title="Organisations"
              value={kpis.totalOrganizations}
              subtitle={`${kpis.newOrgsThisMonth} nouvelle${kpis.newOrgsThisMonth > 1 ? "s" : ""} ce mois`}
              icon={<Globe className="h-4 w-4" />}
            />
            <StatCard
              title="Etablissements actifs"
              value={kpis.totalActiveEstablishments}
              subtitle={`${kpis.totalEstablishments} au total`}
              icon={<Building2 className="h-4 w-4" />}
            />
            <StatCard
              title="Utilisateurs"
              value={kpis.totalActiveUsers}
              subtitle={`${kpis.totalUsers} au total (dont inactifs)`}
              icon={<Users className="h-4 w-4" />}
            />
            <StatCard
              title="Nouveaux ce mois"
              value={kpis.newOrgsThisMonth + kpis.newUsersThisMonth}
              subtitle={`${kpis.newOrgsThisMonth} org + ${kpis.newUsersThisMonth} utilisateurs`}
              icon={<TrendingUp className="h-4 w-4" />}
            />
          </div>
        </SectionErrorBoundary>

        {/* Row 2: Organisations Table */}
        <SectionErrorBoundary label="Tableau des organisations">
          <Card role="region" aria-label="Organisations">
            <CardHeader>
              <CardTitle className="text-base">Organisations ({kpis.totalOrganizations})</CardTitle>
              <CardDescription>
                Vue d'ensemble de toutes les organisations de la plateforme
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OrgsTable orgs={kpis.organizations} />
            </CardContent>
          </Card>
        </SectionErrorBoundary>

        {/* Row 3: Growth / Recent activity */}
        <SectionErrorBoundary label="Croissance">
          <Card role="region" aria-label="Croissance plateforme">
            <CardHeader>
              <CardTitle className="text-base">Croissance</CardTitle>
              <CardDescription>Activite recente et tendances de la plateforme</CardDescription>
            </CardHeader>
            <CardContent>
              <GrowthSummary
                newOrgs={kpis.newOrgsThisMonth}
                newUsers={kpis.newUsersThisMonth}
                organizations={kpis.organizations}
              />
            </CardContent>
          </Card>
        </SectionErrorBoundary>
      </div>
    </ResponsiveLayout>
  );
}
