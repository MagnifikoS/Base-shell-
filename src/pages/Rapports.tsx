import { useState, useMemo, useCallback } from "react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import { usePresenceByDate } from "@/hooks/presence/usePresenceByDate";
import { usePayrollMonthData, type PayrollEmployeeData } from "@/hooks/payroll/usePayrollMonthData";
import { useLeaveRequestsManager } from "@/modules/congesAbsences";
import {
  useMonthInvoices,
  useInvoiceCalculations,
  type MonthNavigation,
  type SupplierMonthSummary,
} from "@/modules/factures";
import { useCashMonth } from "@/modules/cash";
import { getYearMonthFromDateParis } from "@/lib/time/dateKeyParis";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Calendar as CalendarIcon,
  Loader2,
  Users,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Minus,
  Wrench,
} from "lucide-react";
import { PrintButton } from "@/components/ui/PrintButton";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type PeriodMode = "day" | "week" | "month";

interface PeriodRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  label: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Period navigation hook — handles day/week/month selection
// ═══════════════════════════════════════════════════════════════════════════

function usePeriodNav() {
  const currentYM = getYearMonthFromDateParis(new Date());
  const [yearMonth, setYearMonth] = useState(currentYM);
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [customRange, setCustomRange] = useState<{ start: Date | null; end: Date | null }>({
    start: null,
    end: null,
  });
  const [isCustom, setIsCustom] = useState(false);

  // Month navigation
  const prevMonth = useCallback(() => {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }, [yearMonth]);

  const nextMonth = useCallback(() => {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m, 1);
    setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }, [yearMonth]);

  // Day navigation
  const prevDay = useCallback(() => {
    const d = new Date(selectedDay);
    d.setDate(d.getDate() - 1);
    setSelectedDay(d);
  }, [selectedDay]);

  const nextDay = useCallback(() => {
    const d = new Date(selectedDay);
    d.setDate(d.getDate() + 1);
    setSelectedDay(d);
  }, [selectedDay]);

  // Week navigation
  const getWeekMonday = useCallback((date: Date): Date => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d;
  }, []);

  const prevWeek = useCallback(() => {
    const d = new Date(selectedDay);
    d.setDate(d.getDate() - 7);
    setSelectedDay(d);
  }, [selectedDay]);

  const nextWeek = useCallback(() => {
    const d = new Date(selectedDay);
    d.setDate(d.getDate() + 7);
    setSelectedDay(d);
  }, [selectedDay]);

  // Format date as YYYY-MM-DD
  const formatDateKey = useCallback((d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  // Current period range
  const periodRange: PeriodRange = useMemo(() => {
    if (isCustom && customRange.start && customRange.end) {
      return {
        start: formatDateKey(customRange.start),
        end: formatDateKey(customRange.end),
        label: `${customRange.start.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} - ${customRange.end.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}`,
      };
    }

    switch (periodMode) {
      case "day": {
        const key = formatDateKey(selectedDay);
        return {
          start: key,
          end: key,
          label: selectedDay.toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          }),
        };
      }
      case "week": {
        const monday = getWeekMonday(selectedDay);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return {
          start: formatDateKey(monday),
          end: formatDateKey(sunday),
          label: `Sem. du ${monday.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} au ${sunday.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`,
        };
      }
      case "month":
      default: {
        const [y, m] = yearMonth.split("-").map(Number);
        const start = `${yearMonth}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
        const d = new Date(y, m - 1, 1);
        const label = d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
        return { start, end, label };
      }
    }
  }, [periodMode, yearMonth, selectedDay, isCustom, customRange, formatDateKey, getWeekMonday]);

  const handleModeChange = useCallback((value: string) => {
    if (value) {
      setPeriodMode(value as PeriodMode);
      setIsCustom(false);
    }
  }, []);

  const handleCustomToggle = useCallback(() => {
    setIsCustom((prev) => !prev);
    if (!customRange.start) {
      setCustomRange({ start: new Date(), end: new Date() });
    }
  }, [customRange.start]);

  const prev = periodMode === "day" ? prevDay : periodMode === "week" ? prevWeek : prevMonth;
  const next = periodMode === "day" ? nextDay : periodMode === "week" ? nextWeek : nextMonth;

  return {
    yearMonth,
    periodMode,
    periodRange,
    selectedDay,
    setSelectedDay,
    customRange,
    setCustomRange,
    isCustom,
    handleCustomToggle,
    handleModeChange,
    prev,
    next,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Previous month helper
// ═══════════════════════════════════════════════════════════════════════════

function getPreviousYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const prevYear = m === 1 ? y - 1 : y;
  const prevMonth = m === 1 ? 12 : m - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

function yearMonthToMonthNav(ym: string): MonthNavigation {
  const [year, month] = ym.split("-").map(Number);
  return { year, month };
}

// ═══════════════════════════════════════════════════════════════════════════
// Format helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatEur(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function formatEurFromEur(amount: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

function formatDateFr(dateStr: string): string {
  if (!dateStr) return "\u2014";
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Period comparison helper
// ═══════════════════════════════════════════════════════════════════════════

interface ComparisonResult {
  delta: number;
  percent: number | null;
  direction: "up" | "down" | "flat";
}

function computeComparison(current: number, previous: number): ComparisonResult {
  const delta = current - previous;
  if (previous === 0) {
    return { delta, percent: null, direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat" };
  }
  const percent = (delta / Math.abs(previous)) * 100;
  return {
    delta,
    percent,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

function ComparisonBadge({ comparison }: { comparison: ComparisonResult }) {
  if (comparison.direction === "flat") {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        stable
      </span>
    );
  }

  const isUp = comparison.direction === "up";
  const color = isUp ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400";
  const Icon = isUp ? TrendingUp : TrendingDown;
  const sign = isUp ? "+" : "";
  const percentStr = comparison.percent != null ? `${sign}${comparison.percent.toFixed(1)}%` : "";

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      {percentStr}
      <span className="text-muted-foreground ml-1">vs mois prec.</span>
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CSV export
// ═══════════════════════════════════════════════════════════════════════════

function downloadCsv(filename: string, rows: string[][]) {
  const bom = "\uFEFF"; // UTF-8 BOM for Excel
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════
// Loading skeleton
// ═══════════════════════════════════════════════════════════════════════════

function RapportsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Empty state
// ═══════════════════════════════════════════════════════════════════════════

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 1: Rapport de Presence
// ═══════════════════════════════════════════════════════════════════════════

interface PresenceTabProps {
  employees: Array<{
    userId: string;
    fullName: string;
    sessions: Array<{
      clockIn: string | null;
      lateMinutes: number;
      status: string;
    }>;
    totalLateMinutes: number;
  }>;
  serviceDay: string;
  yearMonth: string;
}

function PresenceTab({ employees, serviceDay, yearMonth }: PresenceTabProps) {
  const presenceData = useMemo(() => {
    return employees.map((emp) => {
      const sessionsWithClockIn = emp.sessions.filter((s) => s.clockIn);
      const absentSessions = emp.sessions.filter((s) => s.status === "absent");
      const workedSessions = sessionsWithClockIn.length;
      return {
        userId: emp.userId,
        fullName: emp.fullName,
        workedSessions,
        totalLateMinutes: emp.totalLateMinutes,
        absentCount: absentSessions.length,
        isPresent: sessionsWithClockIn.length > 0,
      };
    });
  }, [employees]);

  const handleExport = () => {
    const header = ["Employe", "Present", "Sessions travaillees", "Retard (min)", "Absences"];
    const data = presenceData.map((emp) => [
      emp.fullName,
      emp.isPresent ? "Oui" : "Non",
      String(emp.workedSessions),
      String(emp.totalLateMinutes),
      String(emp.absentCount),
    ]);
    downloadCsv(`rapport-presence-${serviceDay || yearMonth}.csv`, [header, ...data]);
  };

  if (employees.length === 0) {
    return <EmptyState message="Aucune donnee de presence pour cette date." />;
  }

  const presentCount = presenceData.filter((e) => e.isPresent).length;
  const totalLate = presenceData.reduce((sum, e) => sum + e.totalLateMinutes, 0);
  const totalAbsent = presenceData.filter((e) => !e.isPresent).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Rapport de presence</CardTitle>
          <CardDescription>
            {serviceDay ? `Journee du ${formatDateFr(serviceDay)}` : "Aucune journee de service"} —{" "}
            {employees.length} employes planifies
          </CardDescription>
          <div className="flex gap-4 mt-2 text-sm">
            <span className="text-green-600 dark:text-green-400 font-medium">
              {presentCount} presents
            </span>
            <span className="text-orange-600 dark:text-orange-400 font-medium">
              {totalLate} min de retard
            </span>
            <span className="text-red-600 dark:text-red-400 font-medium">
              {totalAbsent} absents
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          aria-label="Exporter la presence en CSV"
        >
          <Download className="h-4 w-4 mr-1" />
          CSV
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table aria-label="Rapport de presence du jour">
          <TableHeader>
            <TableRow>
              <TableHead>Employe</TableHead>
              <TableHead className="text-center">Present</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Retard (min)</TableHead>
              <TableHead className="text-right">Absences</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {presenceData.map((emp) => (
              <TableRow key={emp.userId}>
                <TableCell className="font-medium truncate max-w-[200px]">{emp.fullName}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={emp.isPresent ? "default" : "destructive"} className="text-xs">
                    {emp.isPresent ? "Oui" : "Non"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{emp.workedSessions}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {emp.totalLateMinutes > 0 ? (
                    <span className="text-orange-600 dark:text-orange-400">
                      {emp.totalLateMinutes}
                    </span>
                  ) : (
                    "0"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {emp.absentCount > 0 ? (
                    <span className="text-red-600 dark:text-red-400">{emp.absentCount}</span>
                  ) : (
                    "0"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 2: Rapport des Conges
// ═══════════════════════════════════════════════════════════════════════════

interface LeaveRequest {
  id: string;
  user_id: string;
  leave_date: string;
  leave_type: "absence" | "cp";
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  user_name?: string;
}

interface CongesTabProps {
  leaveRequests: LeaveRequest[];
  yearMonth: string;
  label: string;
  isLoading?: boolean;
  error?: Error | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  approved: "Approuve",
  rejected: "Refuse",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  approved: "default",
  rejected: "destructive",
};

const TYPE_LABELS: Record<string, string> = {
  cp: "Conge paye",
  absence: "Absence",
};

function CongesTab({ leaveRequests, yearMonth, label, isLoading, error }: CongesTabProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    if (statusFilter === "all") return leaveRequests;
    return leaveRequests.filter((l) => l.status === statusFilter);
  }, [leaveRequests, statusFilter]);

  const handleExport = () => {
    const header = ["Employe", "Type", "Date", "Statut", "Motif"];
    const data = filtered.map((l) => [
      l.user_name || l.user_id,
      TYPE_LABELS[l.leave_type] || l.leave_type,
      formatDateFr(l.leave_date),
      STATUS_LABELS[l.status] || l.status,
      l.reason || "",
    ]);
    downloadCsv(`rapport-conges-${yearMonth}.csv`, [header, ...data]);
  };

  const approvedCount = leaveRequests.filter((l) => l.status === "approved").length;
  const pendingCount = leaveRequests.filter((l) => l.status === "pending").length;
  const rejectedCount = leaveRequests.filter((l) => l.status === "rejected").length;
  const cpCount = leaveRequests.filter(
    (l) => l.leave_type === "cp" && l.status === "approved"
  ).length;
  const absenceCount = leaveRequests.filter(
    (l) => l.leave_type === "absence" && l.status === "approved"
  ).length;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive">
              Erreur lors du chargement des conges : {error.message || "Une erreur est survenue"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Rapport des conges</CardTitle>
          <CardDescription>
            {label} — {leaveRequests.length} demandes
          </CardDescription>
          <div className="flex gap-4 mt-2 text-sm">
            <span className="text-green-600 dark:text-green-400 font-medium">
              {approvedCount} approuvees
            </span>
            <span className="text-orange-600 dark:text-orange-400 font-medium">
              {pendingCount} en attente
            </span>
            <span className="text-red-600 dark:text-red-400 font-medium">
              {rejectedCount} refusees
            </span>
            <span className="text-muted-foreground">
              ({cpCount} CP, {absenceCount} absences)
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Filtrer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="pending">En attente</SelectItem>
              <SelectItem value="approved">Approuves</SelectItem>
              <SelectItem value="rejected">Refuses</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            aria-label="Exporter les conges en CSV"
          >
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {filtered.length === 0 ? (
          <EmptyState message="Aucune demande de conge pour cette periode." />
        ) : (
          <Table aria-label="Rapport des conges et absences">
            <TableHeader>
              <TableRow>
                <TableHead>Employe</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Motif</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium truncate max-w-[200px]">
                    {l.user_name || "\u2014"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {TYPE_LABELS[l.leave_type] || l.leave_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDateFr(l.leave_date)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[l.status] || "outline"} className="text-xs">
                      {STATUS_LABELS[l.status] || l.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground truncate max-w-[200px]">
                    {l.reason || "\u2014"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 3: Resume Paie (enhanced with masse salariale + comparison)
// ═══════════════════════════════════════════════════════════════════════════

interface PayrollTabProps {
  employees: PayrollEmployeeData[];
  totals: {
    totalGrossBase: number;
    totalNetBase: number;
    totalExtras: number;
    totalCpDays: number;
    totalAbsences: number;
    totalDeductions: number;
    totalMassToDisburse: number;
    totalChargesFixed: number;
    totalPayrollMass: number;
    totalCashAmount: number;
  };
  previousTotals: {
    totalGrossBase: number;
    totalNetBase: number;
    totalExtras: number;
    totalMassToDisburse: number;
    totalChargesFixed: number;
    totalPayrollMass: number;
    totalCashAmount: number;
  } | null;
  yearMonth: string;
  label: string;
}

function PayrollTab({ employees, totals, previousTotals, yearMonth, label }: PayrollTabProps) {
  const handleExport = () => {
    const header = [
      "Employe",
      "Salaire brut (EUR)",
      "Salaire net (EUR)",
      "Heures travaillees",
      "Heures sup (min)",
      "Primes extras (EUR)",
      "CP (jours)",
      "Absences (jours)",
      "Retards (min)",
      "Deductions (EUR)",
    ];
    const data = employees.map((emp) => [
      emp.fullName,
      formatEur(emp.line.gross_salary),
      formatEur(emp.line.net_salary),
      formatHours(emp.line.workedMinutesMonth),
      String(emp.line.totalExtraMinutesMonth),
      formatEur(emp.line.totalExtraAmount),
      String(emp.line.cpDays),
      String(emp.line.absenceDaysTotal),
      String(emp.line.lateMinutesTotal),
      formatEur(emp.line.timeDeductionAmount),
    ]);
    downloadCsv(`rapport-paie-${yearMonth}.csv`, [header, ...data]);
  };

  if (employees.length === 0) {
    return <EmptyState message="Aucune donnee de paie pour ce mois." />;
  }

  const totalWorkedMinutes = employees.reduce((sum, e) => sum + e.line.workedMinutesMonth, 0);
  const totalExtraMinutes = employees.reduce((sum, e) => sum + e.line.totalExtraMinutesMonth, 0);
  const totalLateMinutes = employees.reduce((sum, e) => sum + e.line.lateMinutesTotal, 0);

  // Comparisons with previous month
  const massComp = previousTotals
    ? computeComparison(totals.totalMassToDisburse, previousTotals.totalMassToDisburse)
    : null;
  const chargesComp = previousTotals
    ? computeComparison(totals.totalChargesFixed, previousTotals.totalChargesFixed)
    : null;
  const payrollMassComp = previousTotals
    ? computeComparison(totals.totalPayrollMass, previousTotals.totalPayrollMass)
    : null;
  const extrasComp = previousTotals
    ? computeComparison(totals.totalExtras, previousTotals.totalExtras)
    : null;

  return (
    <div className="space-y-4">
      {/* Masse salariale breakdown - detailed cards */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Masse salariale</CardTitle>
          <CardDescription>{label} — Vue d'ensemble</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
            {/* Masse totale a verser */}
            <div className="p-3 rounded-lg border bg-card">
              <p className="text-xs text-muted-foreground">Masse totale a verser</p>
              <p className="text-lg font-bold tabular-nums">
                {formatEur(totals.totalMassToDisburse)}
              </p>
              {massComp && <ComparisonBadge comparison={massComp} />}
            </div>

            {/* Charges patronales */}
            <div className="p-3 rounded-lg border bg-card">
              <p className="text-xs text-muted-foreground">Charges patronales</p>
              <p className="text-lg font-bold tabular-nums">
                {formatEur(totals.totalChargesFixed)}
              </p>
              {chargesComp && <ComparisonBadge comparison={chargesComp} />}
            </div>

            {/* Masse salariale totale */}
            <div className="p-3 rounded-lg border bg-primary/5">
              <p className="text-xs text-muted-foreground">Masse salariale totale</p>
              <p className="text-lg font-bold tabular-nums text-primary">
                {formatEur(totals.totalPayrollMass)}
              </p>
              {payrollMassComp && <ComparisonBadge comparison={payrollMassComp} />}
            </div>

            {/* Salaires nets */}
            <div className="p-3 rounded-lg border bg-card">
              <p className="text-xs text-muted-foreground">Salaires nets</p>
              <p className="text-lg font-bold tabular-nums">{formatEur(totals.totalNetBase)}</p>
            </div>

            {/* Extras detectes */}
            <div className="p-3 rounded-lg border bg-card">
              <p className="text-xs text-muted-foreground">Extras detectes</p>
              <p className="text-lg font-bold tabular-nums text-blue-600 dark:text-blue-400">
                {formatEur(totals.totalExtras)}
              </p>
              {extrasComp && <ComparisonBadge comparison={extrasComp} />}
            </div>

            {/* Paiement especes */}
            <div className="p-3 rounded-lg border bg-card">
              <p className="text-xs text-muted-foreground">Paiement especes</p>
              <p className="text-lg font-bold tabular-nums">{formatEur(totals.totalCashAmount)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payroll summary cards - operational */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Masse a verser</p>
            <p className="text-lg font-bold tabular-nums">
              {formatEur(totals.totalMassToDisburse)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Charges patronales</p>
            <p className="text-lg font-bold tabular-nums">{formatEur(totals.totalChargesFixed)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Heures totales</p>
            <p className="text-lg font-bold tabular-nums">{formatHours(totalWorkedMinutes)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Retards cumules</p>
            <p className="text-lg font-bold tabular-nums text-orange-600 dark:text-orange-400">
              {formatHours(totalLateMinutes)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payroll detail table */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Detail paie par employe</CardTitle>
            <CardDescription>
              {label} — {employees.length} employes
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            aria-label="Exporter la paie en CSV"
          >
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table aria-label="Detail de paie par employe">
            <TableHeader>
              <TableRow>
                <TableHead>Employe</TableHead>
                <TableHead className="text-right">Brut</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Heures</TableHead>
                <TableHead className="text-right">H. sup</TableHead>
                <TableHead className="text-right">Extras</TableHead>
                <TableHead className="text-right">CP</TableHead>
                <TableHead className="text-right">Absences</TableHead>
                <TableHead className="text-right">Retards</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((emp) => (
                <TableRow key={emp.userId}>
                  <TableCell className="font-medium truncate max-w-[150px]">
                    {emp.fullName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatEur(emp.line.gross_salary)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatEur(emp.line.net_salary)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatHours(emp.line.workedMinutesMonth)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {emp.line.totalExtraMinutesMonth > 0 ? (
                      <span className="text-blue-600 dark:text-blue-400">
                        {formatHours(emp.line.totalExtraMinutesMonth)}
                      </span>
                    ) : (
                      "0h"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {emp.line.totalExtraAmount > 0
                      ? formatEur(emp.line.totalExtraAmount)
                      : "\u2014"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {emp.line.cpDays > 0 ? emp.line.cpDays : "\u2014"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {emp.line.absenceDaysTotal > 0 ? (
                      <span className="text-red-600 dark:text-red-400">
                        {emp.line.absenceDaysTotal}
                      </span>
                    ) : (
                      "\u2014"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {emp.line.lateMinutesTotal > 0 ? (
                      <span className="text-orange-600 dark:text-orange-400">
                        {emp.line.lateMinutesTotal} min
                      </span>
                    ) : (
                      "\u2014"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {emp.line.timeDeductionAmount > 0
                      ? formatEur(emp.line.timeDeductionAmount)
                      : "\u2014"}
                  </TableCell>
                </TableRow>
              ))}
              {/* Totals row */}
              <TableRow className="border-t-2 font-semibold bg-muted/50">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatEur(totals.totalGrossBase)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatEur(totals.totalNetBase)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatHours(totalWorkedMinutes)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatHours(totalExtraMinutes)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatEur(totals.totalExtras)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{totals.totalCpDays}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatEur(totals.totalAbsences)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatHours(totalLateMinutes)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatEur(totals.totalDeductions)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 4: Achats (new)
// ═══════════════════════════════════════════════════════════════════════════

interface AchatsTabProps {
  supplierSummaries: SupplierMonthSummary[];
  monthTotal: number;
  invoiceCount: number;
  previousMonthTotal: number | null;
  yearMonth: string;
  label: string;
  isLoading: boolean;
}

function AchatsTab({
  supplierSummaries,
  monthTotal,
  invoiceCount,
  previousMonthTotal,
  yearMonth,
  label,
  isLoading,
}: AchatsTabProps) {
  const handleExport = () => {
    const header = ["Fournisseur", "Nb factures", "Montant (EUR)"];
    const data = supplierSummaries.map((s) => [
      s.supplier_name,
      String(s.invoice_count),
      formatEurFromEur(s.total_amount),
    ]);
    const totalRow = ["TOTAL", String(invoiceCount), formatEurFromEur(monthTotal)];
    downloadCsv(`rapport-achats-${yearMonth}.csv`, [header, ...data, totalRow]);
  };

  const comparison =
    previousMonthTotal != null ? computeComparison(monthTotal, previousMonthTotal) : null;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Monthly total summary */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total achats du mois</p>
            <p className="text-lg font-bold tabular-nums">{formatEurFromEur(monthTotal)}</p>
            {comparison && <ComparisonBadge comparison={comparison} />}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Nombre de factures</p>
            <p className="text-lg font-bold tabular-nums">{invoiceCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Fournisseurs</p>
            <p className="text-lg font-bold tabular-nums">{supplierSummaries.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Supplier breakdown table */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Achats par fournisseur</CardTitle>
            <CardDescription>
              {label} — {supplierSummaries.length} fournisseurs
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            aria-label="Exporter les achats en CSV"
          >
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {supplierSummaries.length === 0 ? (
            <EmptyState message="Aucune facture pour ce mois." />
          ) : (
            <Table aria-label="Achats par fournisseur">
              <TableHeader>
                <TableRow>
                  <TableHead>Fournisseur</TableHead>
                  <TableHead className="text-right">Nb factures</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="text-right">% du total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplierSummaries.map((s) => {
                  const pct = monthTotal > 0 ? (s.total_amount / monthTotal) * 100 : 0;
                  return (
                    <TableRow key={s.supplier_id}>
                      <TableCell className="font-medium truncate max-w-[200px]">
                        {s.supplier_name}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.invoice_count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatEurFromEur(s.total_amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {pct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Totals row */}
                <TableRow className="border-t-2 font-semibold bg-muted/50">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{invoiceCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatEurFromEur(monthTotal)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Period Navigation UI
// ═══════════════════════════════════════════════════════════════════════════

interface PeriodNavigationProps {
  periodMode: PeriodMode;
  periodRange: PeriodRange;
  selectedDay: Date;
  isCustom: boolean;
  onModeChange: (mode: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onDaySelect: (day: Date) => void;
  onCustomToggle: () => void;
  customRange: { start: Date | null; end: Date | null };
  onCustomRangeChange: (range: { start: Date | null; end: Date | null }) => void;
}

function PeriodNavigation({
  periodMode,
  periodRange,
  selectedDay,
  isCustom,
  onModeChange,
  onPrev,
  onNext,
  onDaySelect,
  onCustomToggle,
  customRange,
  onCustomRangeChange,
}: PeriodNavigationProps) {
  return (
    <div className="space-y-3">
      {/* Mode selector */}
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          value={isCustom ? "" : periodMode}
          onValueChange={onModeChange}
          size="sm"
          className="border rounded-md p-0.5"
        >
          <ToggleGroupItem value="day" className="text-xs px-3">
            Jour
          </ToggleGroupItem>
          <ToggleGroupItem value="week" className="text-xs px-3">
            Semaine
          </ToggleGroupItem>
          <ToggleGroupItem value="month" className="text-xs px-3">
            Mois
          </ToggleGroupItem>
        </ToggleGroup>

        <Button
          variant={isCustom ? "default" : "outline"}
          size="sm"
          onClick={onCustomToggle}
          className="text-xs"
        >
          <CalendarIcon className="h-3.5 w-3.5 mr-1" />
          Periode personnalisee
        </Button>
      </div>

      {/* Navigation arrows + label (non-custom mode) */}
      {!isCustom && (
        <div
          className="flex items-center gap-2"
          role="navigation"
          aria-label="Navigation par periode"
        >
          <Button variant="outline" size="icon" onClick={onPrev} aria-label="Periode precedente">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium capitalize min-w-[180px] text-center">
            {periodRange.label}
          </span>
          <Button variant="outline" size="icon" onClick={onNext} aria-label="Periode suivante">
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Day picker (only for day mode) */}
          {periodMode === "day" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <CalendarIcon className="h-3.5 w-3.5 mr-1" />
                  Choisir
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDay}
                  onSelect={(date) => date && onDaySelect(date)}
                  locale={undefined}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {/* Custom date range pickers */}
      {isCustom && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Du</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs">
                  <CalendarIcon className="h-3.5 w-3.5 mr-1" />
                  {customRange.start ? customRange.start.toLocaleDateString("fr-FR") : "Debut"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={customRange.start ?? undefined}
                  onSelect={(date) => date && onCustomRangeChange({ ...customRange, start: date })}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">au</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs">
                  <CalendarIcon className="h-3.5 w-3.5 mr-1" />
                  {customRange.end ? customRange.end.toLocaleDateString("fr-FR") : "Fin"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={customRange.end ?? undefined}
                  onSelect={(date) => date && onCustomRangeChange({ ...customRange, end: date })}
                />
              </PopoverContent>
            </Popover>
          </div>
          <span className="text-sm text-muted-foreground">{periodRange.label}</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

export default function Rapports() {
  const { activeEstablishment } = useEstablishment();
  const estabId = activeEstablishment?.id ?? null;

  const {
    yearMonth,
    periodMode,
    periodRange,
    selectedDay,
    setSelectedDay,
    customRange,
    setCustomRange,
    isCustom,
    handleCustomToggle,
    handleModeChange,
    prev,
    next,
  } = usePeriodNav();

  // Service day for "today" presence
  const { data: serviceDay, error: serviceDayError } = useServiceDayToday(estabId);

  // Presence for today
  const {
    employees: presenceToday,
    isLoading: presenceLoading,
    error: presenceError,
  } = usePresenceByDate({
    establishmentId: estabId,
    dayDate: serviceDay ?? "",
    enabled: !!estabId && !!serviceDay,
  });

  // Payroll for selected month
  const {
    employees: payrollEmployees,
    totals: payrollTotals,
    isLoading: payrollLoading,
    error: payrollError,
  } = usePayrollMonthData(yearMonth);

  // Previous month payroll for comparison
  const previousYearMonth = getPreviousYearMonth(yearMonth);
  const { totals: previousPayrollTotals, isLoading: previousPayrollLoading } =
    usePayrollMonthData(previousYearMonth);

  // Leave requests for selected month
  const {
    data: leaveRequests,
    isLoading: leavesLoading,
    error: leavesError,
  } = useLeaveRequestsManager(yearMonth, "all");

  // Cash month data for shortage & maintenance totals
  const [cashYear, cashMonth] = yearMonth.split("-").map(Number);
  const {
    totalShortage: monthShortage,
    totalMaintenance: monthMaintenance,
    isLoading: cashMonthLoading,
  } = useCashMonth({ establishmentId: estabId, year: cashYear, month: cashMonth });

  // Invoice data for Achats tab — current month
  const monthNav: MonthNavigation = yearMonthToMonthNav(yearMonth);
  const {
    data: invoices = [],
    isLoading: invoicesLoading,
    error: invoicesError,
  } = useMonthInvoices(monthNav);

  const {
    supplierSummaries,
    monthTotal: invoiceMonthTotal,
    invoiceCount,
  } = useInvoiceCalculations(invoices);

  // Previous month invoices for comparison
  const prevMonthNav: MonthNavigation = yearMonthToMonthNav(previousYearMonth);
  const { data: prevInvoices = [] } = useMonthInvoices(prevMonthNav);
  const { monthTotal: prevInvoiceMonthTotal } = useInvoiceCalculations(prevInvoices);

  const isLoading = presenceLoading || payrollLoading;
  // leavesError is handled inside CongesTab — don't block entire page for it
  const queryError = serviceDayError || presenceError || payrollError || invoicesError;

  // Build previous totals for comparison (only when data is loaded)
  const previousTotalsForComparison =
    !previousPayrollLoading && previousPayrollTotals
      ? {
          totalGrossBase: previousPayrollTotals.totalGrossBase,
          totalNetBase: previousPayrollTotals.totalNetBase,
          totalExtras: previousPayrollTotals.totalExtras,
          totalMassToDisburse: previousPayrollTotals.totalMassToDisburse,
          totalChargesFixed: previousPayrollTotals.totalChargesFixed,
          totalPayrollMass: previousPayrollTotals.totalPayrollMass,
          totalCashAmount: previousPayrollTotals.totalCashAmount,
        }
      : null;

  if (!estabId) {
    return (
      <ResponsiveLayout>
        <div className="p-6 space-y-4">
          <h1 className="text-2xl font-semibold text-foreground">Rapports</h1>
          <p className="text-muted-foreground">
            Selectionnez un etablissement pour voir les rapports.
          </p>
        </div>
      </ResponsiveLayout>
    );
  }

  return (
    <ResponsiveLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Rapports</h1>
            <p className="text-sm text-muted-foreground">{activeEstablishment?.name}</p>
          </div>
          <PrintButton />
        </div>

        {/* Period navigation */}
        <PeriodNavigation
          periodMode={periodMode}
          periodRange={periodRange}
          selectedDay={selectedDay}
          isCustom={isCustom}
          onModeChange={handleModeChange}
          onPrev={prev}
          onNext={next}
          onDaySelect={setSelectedDay}
          onCustomToggle={handleCustomToggle}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
        />

        {/* Error state */}
        {queryError && !isLoading && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive">
              Erreur lors du chargement des rapports :{" "}
              {(queryError as Error).message || "Une erreur est survenue"}
            </p>
          </div>
        )}

        {/* Full-page error when no data loaded at all */}
        {queryError && !isLoading && !serviceDay && (
          <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
            <AlertTriangle className="h-12 w-12 text-destructive" />
            <p className="text-lg font-medium text-destructive">Erreur de chargement</p>
            <p className="text-sm text-muted-foreground">
              {(queryError as Error).message || "Une erreur est survenue"}
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reessayer
            </Button>
          </div>
        )}

        {/* Monthly Manques & Maintenance totals */}
        {!isLoading && !cashMonthLoading && (
          <div className="grid gap-4 grid-cols-2 max-w-lg">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2">
                  {monthShortage > 0 && (
                    <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                  )}
                  <p className="text-xs text-muted-foreground">Total manques du mois</p>
                </div>
                <p
                  className={`text-lg font-bold tabular-nums ${
                    monthShortage > 0 ? "text-amber-600 dark:text-amber-400" : ""
                  }`}
                >
                  {formatEurFromEur(monthShortage)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">Total maintenance du mois</p>
                </div>
                <p className="text-lg font-bold tabular-nums">
                  {formatEurFromEur(monthMaintenance)}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Loading */}
        {isLoading ? (
          <RapportsSkeleton />
        ) : (
          /* Tabs */
          <Tabs defaultValue="presence" className="w-full">
            <TabsList className="w-full max-w-lg grid grid-cols-4">
              <TabsTrigger value="presence" className="gap-1">
                <Users className="h-3.5 w-3.5 hidden sm:inline" />
                Presence
              </TabsTrigger>
              <TabsTrigger value="conges" className="gap-1">
                <CalendarIcon className="h-3.5 w-3.5 hidden sm:inline" />
                Conges
              </TabsTrigger>
              <TabsTrigger value="paie" className="gap-1">
                <FileText className="h-3.5 w-3.5 hidden sm:inline" />
                Paie
              </TabsTrigger>
              <TabsTrigger value="achats" className="gap-1">
                <ShoppingCart className="h-3.5 w-3.5 hidden sm:inline" />
                Achats
              </TabsTrigger>
            </TabsList>

            <TabsContent value="presence">
              <PresenceTab
                employees={presenceToday}
                serviceDay={serviceDay ?? ""}
                yearMonth={yearMonth}
              />
            </TabsContent>

            <TabsContent value="conges">
              <CongesTab
                leaveRequests={leaveRequests ?? []}
                yearMonth={yearMonth}
                label={periodRange.label}
                isLoading={leavesLoading}
                error={leavesError as Error | null}
              />
            </TabsContent>

            <TabsContent value="paie">
              <PayrollTab
                employees={payrollEmployees}
                totals={payrollTotals}
                previousTotals={previousTotalsForComparison}
                yearMonth={yearMonth}
                label={periodRange.label}
              />
            </TabsContent>

            <TabsContent value="achats">
              <AchatsTab
                supplierSummaries={supplierSummaries}
                monthTotal={invoiceMonthTotal}
                invoiceCount={invoiceCount}
                previousMonthTotal={prevInvoiceMonthTotal ?? null}
                yearMonth={yearMonth}
                label={periodRange.label}
                isLoading={invoicesLoading}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </ResponsiveLayout>
  );
}
