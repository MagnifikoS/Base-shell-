/**
 * Dashboard Widgets — Extracted components for the Establishment Dashboard.
 *
 * Keeps Dashboard.tsx under 400 lines by housing all reusable widget components here.
 */

import { memo, useMemo, lazy, Suspense, type ReactNode } from "react";
import { formatParisHHMM, timeToMinutes } from "@/lib/time/paris";
import { getWeekDates, formatDayShort, formatMinutesToHours } from "@/lib/planning-engine/format";
import type { PresenceEmployeeCard } from "@/lib/presence/presence.compute";
import type { LeaveRequest } from "@/modules/congesAbsences";
import type {
  DailyRevenue,
  TopSupplier,
  InventorySessionSummary,
} from "@/hooks/dashboard/useEstablishmentKPIs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

const EUR = "€";

// Lazy-load recharts to keep it out of the main Dashboard chunk (~108 KB gzip → separate chunk)
const LazyRevenueChartInner = lazy(() =>
  import("./RevenueChartInner").then((m) => ({ default: m.RevenueChartInner }))
);

// ═══════════════════════════════════════════════════════════════════════════
// Stat Card — reusable card for dashboard metrics
// ═══════════════════════════════════════════════════════════════════════════

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  variant?: "default" | "warning" | "success";
}

export const StatCard = memo(function StatCard({
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

// ═══════════════════════════════════════════════════════════════════════════
// Loading skeleton
// ═══════════════════════════════════════════════════════════════════════════

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Revenue Chart — Last 7 days bar chart (lazy-loaded to avoid bundling recharts)
// ═══════════════════════════════════════════════════════════════════════════

export const RevenueChart = memo(function RevenueChart({ data }: { data: DailyRevenue[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        Aucune donnée de caisse disponible.
      </p>
    );
  }

  return (
    <Suspense fallback={<Skeleton className="h-[220px] w-full" />}>
      <LazyRevenueChartInner data={data} />
    </Suspense>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Top Suppliers — monthly expense breakdown
// ═══════════════════════════════════════════════════════════════════════════

export const TopSuppliersWidget = memo(function TopSuppliersWidget({
  suppliers,
  monthTotal,
}: {
  suppliers: TopSupplier[];
  monthTotal: number;
}) {
  if (suppliers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">Aucune facture ce mois-ci.</p>
    );
  }

  return (
    <div className="space-y-3">
      {suppliers.map((s, i) => {
        const pct = monthTotal > 0 ? (s.total_amount / monthTotal) * 100 : 0;
        return (
          <div key={i} className="flex items-center justify-between text-sm">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{s.supplier_name}</p>
              <p className="text-xs text-muted-foreground">
                {s.invoice_count} facture{s.invoice_count > 1 ? "s" : ""}
              </p>
            </div>
            <div className="text-right ml-4">
              <p className="font-mono font-medium">
                {s.total_amount.toLocaleString("fr-FR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {EUR}
              </p>
              <p className="text-xs text-muted-foreground">{pct.toFixed(1)}%</p>
            </div>
          </div>
        );
      })}
      <div className="pt-2 border-t flex items-center justify-between text-sm font-medium">
        <span>Total du mois</span>
        <span className="font-mono">
          {monthTotal.toLocaleString("fr-FR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{" "}
          {EUR}
        </span>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Derniers Pointages — last badge events table
// ═══════════════════════════════════════════════════════════════════════════

export const RecentBadgeEvents = memo(function RecentBadgeEvents({
  employees,
}: {
  employees: PresenceEmployeeCard[];
}) {
  const recentEvents = useMemo(() => {
    const allEvents = employees.flatMap((emp) =>
      emp.allEvents
        .filter((ev) => ev.event_type === "clock_in" || ev.event_type === "clock_out")
        .map((ev) => ({
          ...ev,
          fullName: emp.fullName,
        }))
    );
    allEvents.sort((a, b) => b.effective_at.localeCompare(a.effective_at));
    return allEvents.slice(0, 8);
  }, [employees]);

  if (recentEvents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        Aucun pointage enregistré aujourd'hui.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Heure</TableHead>
          <TableHead>Employé</TableHead>
          <TableHead className="text-right">Type</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {recentEvents.map((ev) => (
          <TableRow key={ev.id}>
            <TableCell className="font-mono text-sm">{formatParisHHMM(ev.effective_at)}</TableCell>
            <TableCell className="text-sm">{ev.fullName}</TableCell>
            <TableCell className="text-right">
              {ev.event_type === "clock_in" ? (
                <Badge variant="default" className="gap-1">
                  <ArrowDownRight className="h-3 w-3" />
                  Arrivée
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <ArrowUpRight className="h-3 w-3" />
                  Départ
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Demandes en attente — pending leave requests table
// ═══════════════════════════════════════════════════════════════════════════

export const PendingLeaveRequests = memo(function PendingLeaveRequests({
  requests,
}: {
  requests: LeaveRequest[];
}) {
  const pending = useMemo(() => requests.slice(0, 8), [requests]);

  if (pending.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">Aucune demande en attente.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employé</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Statut</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pending.map((req) => (
          <TableRow key={req.id}>
            <TableCell className="text-sm">{req.user_name || "—"}</TableCell>
            <TableCell className="text-sm">
              {req.leave_type === "cp" ? "Congé payé" : "Absence"}
            </TableCell>
            <TableCell className="text-sm font-mono">{req.leave_date}</TableCell>
            <TableCell className="text-right">
              <Badge variant="secondary">En attente</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Active Inventory Sessions
// ═══════════════════════════════════════════════════════════════════════════

export const ActiveInventorySessions = memo(function ActiveInventorySessions({
  sessions,
}: {
  sessions: InventorySessionSummary[];
}) {
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">Aucun inventaire en cours.</p>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((s) => {
        const pct =
          s.total_products > 0 ? Math.round((s.counted_products / s.total_products) * 100) : 0;
        return (
          <div key={s.id} className="flex items-center justify-between text-sm">
            <div className="flex-1 min-w-0">
              <p className="font-medium">{s.status === "en_cours" ? "En cours" : "En pause"}</p>
              <p className="text-xs text-muted-foreground">
                {s.counted_products}/{s.total_products} produits comptés
              </p>
            </div>
            <Badge variant={s.status === "en_cours" ? "default" : "secondary"}>{pct}%</Badge>
          </div>
        );
      })}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Weekly Summary — hours/shifts per day this week
// ═══════════════════════════════════════════════════════════════════════════

interface WeeklySummaryProps {
  weekStart: string;
  shiftsByEmployee: Record<
    string,
    { shift_date: string; start_time: string; end_time: string; net_minutes: number }[]
  >;
  serviceDay: string;
}

export const WeeklySummary = memo(function WeeklySummary({
  weekStart,
  shiftsByEmployee,
  serviceDay,
}: WeeklySummaryProps) {
  const weekDates = getWeekDates(weekStart);

  const dayStats = useMemo(
    () =>
      weekDates.map((date) => {
        let totalMinutes = 0;
        const employeesOnDay = new Set<string>();

        for (const [userId, shifts] of Object.entries(shiftsByEmployee)) {
          for (const shift of shifts) {
            if (shift.shift_date === date) {
              employeesOnDay.add(userId);
              if (shift.net_minutes > 0) {
                totalMinutes += shift.net_minutes;
              } else {
                const startMin = timeToMinutes(shift.start_time.slice(0, 5));
                const endMin = timeToMinutes(shift.end_time.slice(0, 5));
                const diff = endMin > startMin ? endMin - startMin : 1440 - startMin + endMin;
                totalMinutes += diff;
              }
            }
          }
        }

        const isToday = date === serviceDay;
        const isPast = date < serviceDay;

        return {
          date,
          dayLabel: formatDayShort(date),
          totalEmployees: employeesOnDay.size,
          totalMinutes,
          formattedHours: formatMinutesToHours(totalMinutes),
          isToday,
          isPast,
        };
      }),
    [weekDates, shiftsByEmployee, serviceDay]
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Jour</TableHead>
          <TableHead className="text-center">Employés</TableHead>
          <TableHead className="text-center">Heures planifiées</TableHead>
          <TableHead className="text-right">Statut</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {dayStats.map((day) => (
          <TableRow key={day.date} className={day.isToday ? "bg-primary/5 font-medium" : ""}>
            <TableCell className="text-sm capitalize">
              {day.dayLabel}{" "}
              <span className="text-muted-foreground font-mono text-xs">{day.date.slice(5)}</span>
            </TableCell>
            <TableCell className="text-center text-sm">{day.totalEmployees}</TableCell>
            <TableCell className="text-center text-sm font-mono">
              {day.totalMinutes > 0 ? day.formattedHours : "—"}
            </TableCell>
            <TableCell className="text-right">
              {day.isToday ? (
                <Badge variant="default">Aujourd'hui</Badge>
              ) : day.isPast ? (
                <Badge variant="outline">Passé</Badge>
              ) : (
                <Badge variant="secondary">À venir</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
});
