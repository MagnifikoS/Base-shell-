/**
 * EmployeeAbsencesPortal - Simple 2-card layout for employee absence management
 *
 * STRUCTURE:
 * - Card 1: "Faire une demande" → Opens declaration form
 * - Card 2: "Mes absences" → Read-only list from SSOT (personnel_leaves + badge)
 *
 * RULES:
 * ❌ NO request viewing (no personnel_leave_requests)
 * ❌ NO status display (pending/approved/rejected)
 * ✅ SSOT: useMyAllAbsences only
 * ✅ Realtime: via existing invalidation (personnel_leaves)
 */

import { useState } from "react";
import {
  Send,
  Calendar,
  ChevronRight,
  ChevronLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText,
  Upload,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

import { MobileAbsenceDeclarationForm } from "./MobileAbsenceDeclarationForm";
import { LeaveConflictDialog } from "./LeaveConflictDialog";
import { useDeclareLeaveRequest, isLeaveConflictError } from "../hooks/useLeaveRequests";
import { useMyAllAbsences } from "../hooks/useMyAllAbsences";
import { useEmployeeHourlyRate } from "../hooks/useEmployeeHourlyRate";
import { groupUnifiedAbsences, type UnifiedAbsenceGroup } from "../utils/groupAbsences";
import { roundCurrency } from "@/lib/payroll/payroll.compute";

// ═══════════════════════════════════════════════════════════════════════════
// NO DEBUG - clean code, SSOT aligned with planning
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// MONTH NAVIGATION HELPERS (using Paris timezone)
// ═══════════════════════════════════════════════════════════════════════════

import { getCurrentParisMonth } from "@/lib/time/paris";
const getParisMonth = getCurrentParisMonth;

function navigateMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  const newYear = date.getFullYear();
  const newMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${newYear}-${newMonth}`;
}

function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

// ═══════════════════════════════════════════════════════════════════════════
// DATE FORMATTING
// ═══════════════════════════════════════════════════════════════════════════

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function formatDateRange(start: string, end: string): string {
  if (start === end) {
    return formatDateShort(start);
  }
  return `${formatDateShort(start)} → ${formatDateShort(end)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ABSENCE GROUP CARD
// ═══════════════════════════════════════════════════════════════════════════

interface AbsenceGroupCardProps {
  group: UnifiedAbsenceGroup;
  dailyDeduction: number;
  canEstimate: boolean;
}

function AbsenceGroupCard({ group, dailyDeduction, canEstimate }: AbsenceGroupCardProps) {
  // Payroll estimation: days × 7h × hourlyRate (simple total only)
  const estimatedDeduction = canEstimate ? roundCurrency(group.dayCount * dailyDeduction) : null;

  return (
    <div className="p-4 bg-muted/50 rounded-lg space-y-2">
      {/* Header: Date range + days count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">
            {formatDateRange(group.dateStart, group.dateEnd)}
          </span>
          {group.dayCount > 1 && (
            <Badge variant="outline" className="text-xs">
              {group.dayCount} jours
            </Badge>
          )}
        </div>
        {/* Estimation simple (montant seul) */}
        {canEstimate && estimatedDeduction !== null && (
          <span className="text-sm font-medium text-muted-foreground">
            ~{estimatedDeduction.toFixed(0)}€
          </span>
        )}
      </div>

      {/* Reason (if any) - formatted based on content */}
      {group.reason && (
        <p className="text-sm text-muted-foreground pl-6">
          {group.reason.toLowerCase() === "maladie" ? "Maladie" : `Motif : ${group.reason}`}
        </p>
      )}

      {/* Justificatif button (UI stub) */}
      <div className="pl-6">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground gap-1 px-0"
          disabled // Stub - feature coming later
        >
          <Upload className="w-3 h-3" />
          Importer un justificatif
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MES ABSENCES DRAWER CONTENT (with month navigation)
// ═══════════════════════════════════════════════════════════════════════════

function MesAbsencesContent() {
  const [yearMonth, setYearMonth] = useState(getParisMonth);
  const { absences, isLoading, error } = useMyAllAbsences({ yearMonth });
  const { data: payrollData, isLoading: _payrollLoading } = useEmployeeHourlyRate();

  const handlePrevMonth = () => setYearMonth((m) => navigateMonth(m, -1));
  const handleNextMonth = () => setYearMonth((m) => navigateMonth(m, 1));

  // Group consecutive absences
  const groups = groupUnifiedAbsences(absences);

  return (
    <div className="space-y-4">
      {/* Month Navigation */}
      <div className="flex items-center justify-between px-2">
        <Button variant="ghost" size="icon" onClick={handlePrevMonth} aria-label="Mois précédent">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="font-medium capitalize">{formatMonth(yearMonth)}</span>
        <Button variant="ghost" size="icon" onClick={handleNextMonth} aria-label="Mois suivant">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Erreur lors du chargement</AlertDescription>
        </Alert>
      )}

      {/* Empty */}
      {!isLoading && !error && groups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Aucune absence</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Les absences validées apparaîtront ici
          </p>
        </div>
      )}

      {/* Content */}
      {!isLoading && !error && groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((group) => (
            <AbsenceGroupCard
              key={group.id}
              group={group}
              dailyDeduction={payrollData.dailyDeduction}
              canEstimate={payrollData.canEstimate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FAIRE UNE DEMANDE DRAWER CONTENT
// ═══════════════════════════════════════════════════════════════════════════

interface DeclarationDrawerContentProps {
  onClose: () => void;
}

function DeclarationDrawerContent({ onClose }: DeclarationDrawerContentProps) {
  const declareMutation = useDeclareLeaveRequest();

  const [uiSuccess, setUiSuccess] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);

  // Conflict dialog state
  const [conflictData, setConflictData] = useState<{
    conflicts_approved: string[];
    conflicts_pending: string[];
  } | null>(null);
  const [showConflictDialog, setShowConflictDialog] = useState(false);

  const clearFeedback = () => {
    setUiError(null);
    setUiSuccess(null);
  };

  // Adapter function to transform old format to new format
  const handleDeclare = async (declaration: {
    date_start: string;
    date_end: string;
    motif_type: "maladie" | "cp" | "autre";
    motif_detail?: string;
  }) => {
    clearFeedback();
    setConflictData(null);

    try {
      const leaveType =
        declaration.motif_type === "maladie"
          ? "am"
          : declaration.motif_type === "cp"
            ? "cp"
            : "absence";
      const requestParams = {
        leave_type: leaveType as "absence" | "cp" | "am",
        date_start: declaration.date_start,
        date_end: declaration.date_end,
        reason:
          declaration.motif_type === "maladie"
            ? "Maladie"
            : declaration.motif_type === "cp"
              ? "Congé payé"
              : declaration.motif_detail || undefined,
      };
      const result = await declareMutation.mutateAsync(requestParams);
      setUiSuccess("Demande envoyée avec succès");

      // Auto-close after success (with delay for feedback)
      setTimeout(() => {
        onClose();
      }, 1500);

      return { dates: result.dates, require_justificatif: declaration.motif_type === "maladie" };
    } catch (err) {
      // Check for conflict error → show popup instead of inline error
      if (isLeaveConflictError(err)) {
        setConflictData({
          conflicts_approved: err.conflicts_approved,
          conflicts_pending: err.conflicts_pending,
        });
        setShowConflictDialog(true);
        throw new Error("__CONFLICT_HANDLED__");
      }

      const errorMsg = err instanceof Error ? err.message : "Erreur lors de l'envoi";
      setUiError(errorMsg);
      throw err;
    }
  };

  return (
    <div className="px-4 pb-8">
      {/* Feedback */}
      {uiSuccess && (
        <Alert className="border-primary/30 bg-primary/10 mb-4">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertDescription className="text-primary-foreground">{uiSuccess}</AlertDescription>
        </Alert>
      )}
      {uiError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{uiError}</AlertDescription>
        </Alert>
      )}

      <MobileAbsenceDeclarationForm
        onDeclare={handleDeclare}
        onSuccess={(msg) => setUiSuccess(msg)}
        onError={(msg) => setUiError(msg)}
      />

      {/* Conflict Dialog */}
      <LeaveConflictDialog
        open={showConflictDialog}
        onClose={() => {
          setShowConflictDialog(false);
          setConflictData(null);
        }}
        conflictData={conflictData}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT: 2-CARD PORTAL
// ═══════════════════════════════════════════════════════════════════════════

export function EmployeeAbsencesPortal() {
  const [declarationOpen, setDeclarationOpen] = useState(false);
  const [absencesOpen, setAbsencesOpen] = useState(false);

  // Get absence count for badge (current Paris month)
  const { absences } = useMyAllAbsences({ yearMonth: getParisMonth() });
  const absenceCount = absences.length;

  return (
    <div className="space-y-4">
      {/* Card 1: Faire une demande */}
      <Drawer open={declarationOpen} onOpenChange={setDeclarationOpen}>
        <DrawerTrigger asChild>
          <Card className="cursor-pointer hover:bg-muted/50 transition-colors active:scale-[0.98]">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Send className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Faire une demande</p>
                  <p className="text-sm text-muted-foreground">Déclarer une absence</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="border-b">
            <DrawerTitle>Faire une demande</DrawerTitle>
          </DrawerHeader>
          <DeclarationDrawerContent onClose={() => setDeclarationOpen(false)} />
        </DrawerContent>
      </Drawer>

      {/* Card 2: Mes absences */}
      <Drawer open={absencesOpen} onOpenChange={setAbsencesOpen}>
        <DrawerTrigger asChild>
          <Card className="cursor-pointer hover:bg-muted/50 transition-colors active:scale-[0.98]">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <p className="font-medium">Mes absences</p>
                  <p className="text-sm text-muted-foreground">Consulter mon historique</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {absenceCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-orange-100 text-orange-700 dark:text-orange-300 dark:bg-orange-900/30 dark:text-orange-400"
                  >
                    {absenceCount}
                  </Badge>
                )}
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </DrawerTrigger>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="border-b">
            <DrawerTitle>Mes absences</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4">
            <MesAbsencesContent />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

export type { UnifiedAbsenceGroup };
