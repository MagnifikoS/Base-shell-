import { Component, type ReactNode } from "react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import { usePresenceByDate } from "@/hooks/presence/usePresenceByDate";
import { useAlerts } from "@/hooks/alerts/useAlerts";
import { usePlanningWeek } from "@/components/planning/hooks/usePlanningWeek";
import { useLeaveRequestsManager } from "@/modules/congesAbsences";
import { getMonday, getWeekDates } from "@/lib/planning-engine/format";
import { useEstablishmentKPIs } from "@/hooks/dashboard/useEstablishmentKPIs";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Euro, AlertTriangle, FileText, Package, ClipboardList } from "lucide-react";
import {
  StatCard,
  DashboardSkeleton,
  RevenueChart,
  TopSuppliersWidget,
  RecentBadgeEvents,
  PendingLeaveRequests,
  ActiveInventorySessions,
  WeeklySummary,
} from "@/components/dashboard/DashboardWidgets";

// ═══════════════════════════════════════════════════════════════════════════
// Error Boundary — isolates optional widgets from crashing the dashboard
// ═══════════════════════════════════════════════════════════════════════════

class WidgetErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const EUR = "€";

function formatEUR(amount: number): string {
  return `${amount.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${EUR}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Dashboard
// ═══════════════════════════════════════════════════════════════════════════

export default function Dashboard() {
  const { activeEstablishment } = useEstablishment();
  const estabId = activeEstablishment?.id ?? null;
  const { isAdmin } = usePermissions();

  // Service day — SSOT from backend
  const {
    data: serviceDay,
    isLoading: serviceDayLoading,
    error: serviceDayError,
  } = useServiceDayToday(estabId);

  // Monday of the current week (for planning)
  const weekStart = serviceDay ? getMonday(new Date(serviceDay + "T12:00:00")) : null;

  // Presence data for today
  const {
    employees: presenceEmployees,
    isLoading: presenceLoading,
    error: presenceError,
  } = usePresenceByDate({
    establishmentId: estabId,
    dayDate: serviceDay ?? "",
    enabled: !!estabId && !!serviceDay,
  });

  // Alerts (missing clock-in/out)
  const { alerts, isLoading: _alertsLoading, error: alertsError } = useAlerts(estabId);

  // Planning data for the week
  const {
    data: planning,
    isLoading: planningLoading,
    error: planningError,
  } = usePlanningWeek(estabId, weekStart);

  // Pending leave requests
  const {
    data: pendingLeaves,
    isLoading: leavesLoading,
    error: leavesError,
  } = useLeaveRequestsManager(undefined, "pending");

  // KPIs (revenue, invoices, stock, inventory)
  const {
    data: kpis,
    isLoading: kpisLoading,
    error: kpisError,
  } = useEstablishmentKPIs(estabId, serviceDay ?? null);

  // ── Derived metrics ────────────────────────────────────────────────────

  // Only block on service day — everything else renders progressively
  const isCriticalLoading = serviceDayLoading;

  // Aggregate query errors for persistent display (non-blocking)
  const queryError =
    serviceDayError || presenceError || alertsError || planningError || leavesError || kpisError;

  if (!estabId) {
    return (
      <ResponsiveLayout>
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">
            Sélectionnez un établissement pour voir le tableau de bord.
          </p>
        </div>
      </ResponsiveLayout>
    );
  }

  // Only show full skeleton while waiting for service day (critical dependency)
  if (isCriticalLoading) {
    return (
      <ResponsiveLayout>
        <DashboardSkeleton />
      </ResponsiveLayout>
    );
  }

  // If service day failed, show error
  if (serviceDayError && !serviceDay) {
    return (
      <ResponsiveLayout>
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
            <p className="text-sm text-destructive">
              Erreur lors du chargement du tableau de bord : {(serviceDayError as Error).message}
            </p>
          </div>
        </div>
      </ResponsiveLayout>
    );
  }

  // Presence stats (available progressively)
  const totalPresent = presenceLoading
    ? 0
    : presenceEmployees.filter((e) => e.sessions.some((s) => s.clockIn)).length;
  const totalPlanned = presenceLoading ? 0 : presenceEmployees.length;

  // Pending leave count
  const pendingLeaveCount = pendingLeaves?.length ?? 0;

  // Alert count
  const alertCount = alerts.length;

  return (
    <ResponsiveLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {activeEstablishment?.name} — {serviceDay}
          </p>
        </div>

        {/* Error banner — only show for non-transient errors (not loading states) */}
        {queryError && !presenceLoading && !planningLoading && !leavesLoading && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
            <p className="text-sm text-destructive">
              Certaines données n'ont pas pu être chargées : {(queryError as Error).message}
            </p>
          </div>
        )}

        {/* Onboarding checklist (admin only) */}
        {isAdmin && (
          <WidgetErrorBoundary>
            <OnboardingChecklist />
          </WidgetErrorBoundary>
        )}

        {/* ═══ Row 1: Key Metrics (4 cards, responsive grid) ═══ */}
        <div
          className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
          role="region"
          aria-label="Indicateurs du jour"
        >
          <WidgetErrorBoundary>
            <StatCard
              title="Chiffre d'affaires du jour"
              value={
                kpisLoading
                  ? "..."
                  : kpis?.todayRevenue != null
                    ? formatEUR(kpis.todayRevenue)
                    : "—"
              }
              subtitle={
                kpisLoading
                  ? "Chargement..."
                  : kpis?.todayRevenue != null
                    ? "Encaissements du jour"
                    : "Pas encore saisi"
              }
              icon={<Euro className="h-4 w-4" />}
            />
          </WidgetErrorBoundary>

          <WidgetErrorBoundary>
            <StatCard
              title="Effectif présent"
              value={presenceLoading ? "..." : `${totalPresent} / ${totalPlanned}`}
              subtitle={
                presenceLoading
                  ? "Chargement..."
                  : totalPlanned > 0
                    ? `${Math.round((totalPresent / totalPlanned) * 100)}% de présence`
                    : "Aucun shift planifié"
              }
              icon={<Users className="h-4 w-4" />}
              variant={totalPresent === totalPlanned && totalPlanned > 0 ? "success" : "default"}
            />
          </WidgetErrorBoundary>

          <WidgetErrorBoundary>
            <StatCard
              title="Produits surveillés"
              value={kpisLoading ? "..." : (kpis?.productsMonitored ?? "—")}
              subtitle={
                kpisLoading
                  ? "Chargement..."
                  : kpis?.productsMonitored != null && kpis.productsMonitored > 0
                    ? `${kpis.productsMonitored} produit${kpis.productsMonitored > 1 ? "s" : ""} avec seuil min.`
                    : "Aucun seuil configuré"
              }
              icon={<Package className="h-4 w-4" />}
            />
          </WidgetErrorBoundary>

          <WidgetErrorBoundary>
            <StatCard
              title="Factures non payées"
              value={kpisLoading ? "..." : (kpis?.unpaidInvoiceCount ?? "—")}
              subtitle={
                kpisLoading
                  ? "Chargement..."
                  : kpis?.unpaidInvoiceCount != null && kpis.unpaidInvoiceCount > 0
                    ? `${kpis.unpaidInvoiceCount} facture${kpis.unpaidInvoiceCount > 1 ? "s" : ""} en attente`
                    : "Tout est à jour"
              }
              icon={<FileText className="h-4 w-4" />}
              variant={
                !kpisLoading && kpis?.unpaidInvoiceCount != null && kpis.unpaidInvoiceCount > 0
                  ? "warning"
                  : "success"
              }
            />
          </WidgetErrorBoundary>
        </div>

        {/* ═══ Row 2: Financial Overview (2 cards side by side) ═══ */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          <WidgetErrorBoundary>
            <Card role="region" aria-label="Chiffre d'affaires - 7 derniers jours">
              <CardHeader>
                <CardTitle className="text-base">CA — 7 derniers jours</CardTitle>
                <CardDescription>Encaissements journaliers de la caisse</CardDescription>
              </CardHeader>
              <CardContent>
                {kpisLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center animate-pulse">
                    Chargement des données...
                  </p>
                ) : kpis ? (
                  <RevenueChart data={kpis.revenueLastDays} />
                ) : (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Données non disponibles
                  </p>
                )}
              </CardContent>
            </Card>
          </WidgetErrorBoundary>

          <WidgetErrorBoundary>
            <Card role="region" aria-label="Top dépenses du mois">
              <CardHeader>
                <CardTitle className="text-base">Top dépenses du mois</CardTitle>
                <CardDescription>Fournisseurs par montant facturé</CardDescription>
              </CardHeader>
              <CardContent>
                {kpisLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center animate-pulse">
                    Chargement des données...
                  </p>
                ) : kpis ? (
                  <TopSuppliersWidget
                    suppliers={kpis.topSuppliers}
                    monthTotal={kpis.monthExpenseTotal}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Données non disponibles
                  </p>
                )}
              </CardContent>
            </Card>
          </WidgetErrorBoundary>
        </div>

        {/* ═══ Row 3: Operations (3 cards) ═══ */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
          {/* Derniers pointages */}
          <WidgetErrorBoundary>
            <Card role="region" aria-label="Derniers pointages">
              <CardHeader>
                <CardTitle className="text-base">Derniers pointages</CardTitle>
                <CardDescription>Pointages les plus récents du jour</CardDescription>
              </CardHeader>
              <CardContent>
                {presenceLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Chargement...</p>
                ) : (
                  <RecentBadgeEvents employees={presenceEmployees} />
                )}
              </CardContent>
            </Card>
          </WidgetErrorBoundary>

          {/* Demandes en attente */}
          <WidgetErrorBoundary>
            <Card role="region" aria-label="Demandes en attente">
              <CardHeader>
                <CardTitle className="text-base">
                  Demandes en attente ({leavesLoading ? "..." : pendingLeaveCount})
                </CardTitle>
                <CardDescription>Congés et absences à valider</CardDescription>
              </CardHeader>
              <CardContent>
                {leavesLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Chargement...</p>
                ) : (
                  <PendingLeaveRequests requests={pendingLeaves ?? []} />
                )}
              </CardContent>
            </Card>
          </WidgetErrorBoundary>

          {/* Inventaires en cours */}
          <WidgetErrorBoundary>
            <Card role="region" aria-label="Inventaires en cours">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardList className="h-4 w-4" />
                  Inventaires en cours
                </CardTitle>
                <CardDescription>Sessions d'inventaire actives</CardDescription>
              </CardHeader>
              <CardContent>
                {kpisLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center animate-pulse">
                    Chargement des données...
                  </p>
                ) : kpis ? (
                  <ActiveInventorySessions sessions={kpis.activeSessions} />
                ) : (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Aucun inventaire en cours
                  </p>
                )}
              </CardContent>
            </Card>
          </WidgetErrorBoundary>
        </div>

        {/* ═══ Row 4: Alerts & Weekly Summary ═══ */}
        {alertCount > 0 && (
          <WidgetErrorBoundary>
            <Card role="region" aria-label="Détail des alertes">
              <CardHeader>
                <CardTitle className="text-base">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500 dark:text-orange-400" />
                    Alertes du jour ({alertCount})
                  </span>
                </CardTitle>
                <CardDescription>Pointages manquants détectés</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2" aria-label="Liste des alertes">
                  {alerts.slice(0, 10).map((alert) => (
                    <li key={alert.id} className="flex items-center justify-between text-sm">
                      <span>{alert.fullName}</span>
                      <Badge
                        variant={alert.type === "missing_clock_in" ? "destructive" : "outline"}
                      >
                        {alert.type === "missing_clock_in"
                          ? `Arrivée manquante (${alert.plannedStart})`
                          : `Départ manquant (${alert.plannedEnd})`}
                      </Badge>
                    </li>
                  ))}
                  {alertCount > 10 && (
                    <li className="text-xs text-muted-foreground">
                      + {alertCount - 10} autres alertes
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          </WidgetErrorBoundary>
        )}

        {weekStart && planning?.shiftsByEmployee && serviceDay && (
          <WidgetErrorBoundary>
            <Card role="region" aria-label="Résumé de la semaine">
              <CardHeader>
                <CardTitle className="text-base">Résumé de la semaine</CardTitle>
                <CardDescription>
                  Planning du {weekStart} au {getWeekDates(weekStart)[6]}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <WeeklySummary
                  weekStart={weekStart}
                  shiftsByEmployee={planning.shiftsByEmployee}
                  serviceDay={serviceDay}
                />
              </CardContent>
            </Card>
          </WidgetErrorBoundary>
        )}
      </div>
    </ResponsiveLayout>
  );
}
