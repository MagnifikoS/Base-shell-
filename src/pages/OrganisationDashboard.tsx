/**
 * OrganisationDashboard — Cross-establishment overview for restaurant group owners.
 *
 * Shows aggregated KPIs across ALL establishments the user has access to.
 * Route: /organisation
 *
 * Uses useOrganisationKPIs hook for data fetching (batch queries via RLS).
 * Comparison table extracted to EstablishmentComparisonTable component.
 */

import { Component, memo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useOrganisationKPIs } from "@/hooks/dashboard/useOrganisationKPIs";
import { EstablishmentComparisonTable } from "@/components/organisation/EstablishmentComparisonTable";
import { formatParisDateKey } from "@/lib/time/dateKeyParis";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Users, CalendarOff, Activity, Eye } from "lucide-react";

/** Lightweight error boundary to isolate optional widgets from crashing the page */
class ErrorBoundarySimple extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  variant?: "default" | "warning" | "success";
}

const StatCard = memo(function StatCard({
  title,
  value,
  subtitle,
  icon,
  variant = "default",
}: StatCardProps) {
  const borderClass =
    variant === "warning"
      ? "border-orange-300 dark:border-orange-700"
      : variant === "success"
        ? "border-green-300 dark:border-green-700"
        : "";

  return (
    <Card className={borderClass} role="region" aria-label={title}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span className="text-muted-foreground" aria-hidden="true">
          {icon}
        </span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
});

function OrganisationSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-64" />
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}

function getPresenceColor(rate: number): string {
  if (rate >= 90)
    return "bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-900/30 dark:text-green-400";
  if (rate >= 70)
    return "bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400";
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
}

interface EstablishmentHealthCardProps {
  name: string;
  presenceRate: number;
  employeesPresent: number;
  employeesPlanned: number;
  pendingLeaves: number;
  onSelect: () => void;
}

const EstablishmentHealthCard = memo(function EstablishmentHealthCard({
  name,
  presenceRate,
  employeesPresent,
  employeesPlanned,
  pendingLeaves,
  onSelect,
}: EstablishmentHealthCardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium truncate">{name}</CardTitle>
          <Badge className={getPresenceColor(presenceRate)}>{presenceRate}%</Badge>
        </div>
        <CardDescription>
          {employeesPresent} / {employeesPlanned} presents
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center justify-between">
          {pendingLeaves > 0 ? (
            <Badge variant="secondary" className="text-xs">
              {pendingLeaves} demande{pendingLeaves > 1 ? "s" : ""}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Aucune demande</span>
          )}
          <Button variant="ghost" size="sm" onClick={onSelect}>
            <Eye className="h-4 w-4 mr-1" />
            Voir
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

export default function OrganisationDashboard() {
  const navigate = useNavigate();
  const { establishments: allEstablishments, setActiveEstablishment } = useEstablishment();
  const { data: kpis, isLoading, isError, refetch } = useOrganisationKPIs();

  const todayKey = formatParisDateKey(new Date());

  const handleSelectEstablishment = (estId: string) => {
    const est = allEstablishments.find((e) => e.id === estId);
    if (est) {
      setActiveEstablishment(est);
      navigate("/dashboard");
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <ResponsiveLayout>
        <OrganisationSkeleton />
      </ResponsiveLayout>
    );
  }

  // Single establishment: show redirect message
  if (allEstablishments.length <= 1) {
    return (
      <ResponsiveLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Organisation</h1>
            <p className="text-sm text-muted-foreground">{todayKey}</p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vue mono-etablissement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Cette vue est optimisee pour les organisations avec plusieurs etablissements. Vous
                n'avez qu'un seul etablissement accessible.
              </p>
              <Button onClick={() => navigate("/dashboard")}>Aller au tableau de bord</Button>
            </CardContent>
          </Card>
        </div>
      </ResponsiveLayout>
    );
  }

  // Error or no data
  if (isError || !kpis) {
    return (
      <ResponsiveLayout>
        <div className="space-y-6">
          <h1 className="text-2xl font-semibold text-foreground">Organisation</h1>
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <p className="text-destructive font-medium">Une erreur est survenue</p>
            <p className="text-muted-foreground text-sm mt-1">
              Impossible de charger les donnees. Veuillez reessayer.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
              Reessayer
            </Button>
          </div>
        </div>
      </ResponsiveLayout>
    );
  }

  return (
    <ResponsiveLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Organisation — {kpis.organizationName}
          </h1>
          <p className="text-sm text-muted-foreground">{todayKey}</p>
        </div>

        {/* Row 1: Aggregate KPIs */}
        <ErrorBoundarySimple>
          <div
            className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
            role="region"
            aria-label="Indicateurs organisation"
          >
            <StatCard
              title="Etablissements actifs"
              value={kpis.activeEstablishments}
              subtitle={`${kpis.totalEstablishments} au total`}
              icon={<Building2 className="h-4 w-4" />}
            />
            <StatCard
              title="Effectif global"
              value={`${kpis.totalEmployeesPresent} / ${kpis.totalEmployeesPlanned}`}
              subtitle={
                kpis.totalEmployeesPlanned > 0
                  ? `${kpis.overallPresenceRate}% de presence`
                  : "Aucun shift prevu"
              }
              icon={<Users className="h-4 w-4" />}
              variant={
                kpis.overallPresenceRate >= 90
                  ? "success"
                  : kpis.overallPresenceRate >= 70
                    ? "default"
                    : "warning"
              }
            />
            <StatCard
              title="Demandes en attente"
              value={kpis.totalPendingLeaves}
              subtitle={
                kpis.totalPendingLeaves > 0 ? "Conges / absences a traiter" : "Aucune demande"
              }
              icon={<CalendarOff className="h-4 w-4" />}
              variant={kpis.totalPendingLeaves > 0 ? "warning" : "default"}
            />
            <StatCard
              title="Activite badges"
              value={kpis.establishments.reduce((s, e) => s + e.todayBadgeEvents, 0)}
              subtitle="Pointages enregistres aujourd'hui"
              icon={<Activity className="h-4 w-4" />}
            />
          </div>
        </ErrorBoundarySimple>

        {/* Row 2: Establishment Comparison Table */}
        <ErrorBoundarySimple>
          <Card role="region" aria-label="Comparaison des etablissements">
            <CardHeader>
              <CardTitle className="text-base">
                Comparaison des etablissements ({kpis.activeEstablishments})
              </CardTitle>
              <CardDescription>Cliquez sur un etablissement pour y acceder</CardDescription>
            </CardHeader>
            <CardContent>
              <EstablishmentComparisonTable establishments={kpis.establishments} />
            </CardContent>
          </Card>
        </ErrorBoundarySimple>

        {/* Row 3: Establishment Health Cards */}
        <ErrorBoundarySimple>
          <div
            className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            role="region"
            aria-label="Sante des etablissements"
          >
            {kpis.establishments.map((est) => (
              <EstablishmentHealthCard
                key={est.id}
                name={est.name}
                presenceRate={est.presenceRate}
                employeesPresent={est.employeesPresent}
                employeesPlanned={est.employeesPlanned}
                pendingLeaves={est.pendingLeaves}
                onSelect={() => handleSelectEstablishment(est.id)}
              />
            ))}
          </div>
        </ErrorBoundarySimple>
      </div>
    </ResponsiveLayout>
  );
}
