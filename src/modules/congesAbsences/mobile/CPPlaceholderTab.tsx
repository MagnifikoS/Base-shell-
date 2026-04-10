/**
 * CP Tab - Employee portal for paid leave (Congés Payés)
 * Same 2-card layout as EmployeeAbsencesPortal:
 *   Card 1: "Faire une demande" → Opens form pre-set to CP
 *   Card 2: "Mes congés" → List of CP requests with status
 */

import { useState } from "react";
import {
  Send,
  Palmtree,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Calendar,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

import { MobileAbsenceDeclarationForm } from "../components/MobileAbsenceDeclarationForm";
import { LeaveConflictDialog } from "../components/LeaveConflictDialog";
import {
  useDeclareLeaveRequest,
  useMyLeaveRequests,
  isLeaveConflictError,
} from "../hooks/useLeaveRequests";

// ═══════════════════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS BADGE
// ═══════════════════════════════════════════════════════════════════════════

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "approved":
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1">
          <CheckCircle2 className="w-3 h-3" />
          Validé
        </Badge>
      );
    case "rejected":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="w-3 h-3" />
          Refusé
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="w-3 h-3" />
          En attente
        </Badge>
      );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MES CONGÉS DRAWER
// ═══════════════════════════════════════════════════════════════════════════

function MesCongesContent() {
  const { data: allRequests = [], isLoading, error } = useMyLeaveRequests(12);

  // Filter CP requests only
  const cpRequests = allRequests.filter((r) => r.leave_type === "cp");

  // Group consecutive dates with same status (sorted asc for correct grouping)
  const sorted = [...cpRequests].sort((a, b) => a.leave_date.localeCompare(b.leave_date));

  const groups: Array<{
    id: string;
    dateStart: string;
    dateEnd: string;
    dayCount: number;
    status: string;
  }> = [];

  for (const req of sorted) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.status === req.status) {
      const prev = new Date(lastGroup.dateEnd + "T12:00:00Z");
      const curr = new Date(req.leave_date + "T12:00:00Z");
      const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays === 1) {
        lastGroup.dateEnd = req.leave_date;
        lastGroup.dayCount++;
        continue;
      }
    }
    groups.push({
      id: req.id,
      dateStart: req.leave_date,
      dateEnd: req.leave_date,
      dayCount: 1,
      status: req.status,
    });
  }

  // Display most recent first
  groups.sort((a, b) => b.dateStart.localeCompare(a.dateStart));

  return (
    <div className="space-y-4 pb-6">
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Erreur lors du chargement</AlertDescription>
        </Alert>
      )}

      {!isLoading && !error && groups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Palmtree className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Aucun congé payé</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Vos demandes de CP apparaîtront ici
          </p>
        </div>
      )}

      {!isLoading && !error && groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.id} className="p-4 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium text-sm">
                    {group.dateStart === group.dateEnd
                      ? formatDateShort(group.dateStart)
                      : `${formatDateShort(group.dateStart)} → ${formatDateShort(group.dateEnd)}`}
                  </span>
                  {group.dayCount > 1 && (
                    <Badge variant="outline" className="text-xs">
                      {group.dayCount} jours
                    </Badge>
                  )}
                </div>
                <StatusBadge status={group.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DECLARATION DRAWER (pre-set to CP)
// ═══════════════════════════════════════════════════════════════════════════

interface CPDeclarationDrawerContentProps {
  onClose: () => void;
}

function CPDeclarationDrawerContent({ onClose }: CPDeclarationDrawerContentProps) {
  const declareMutation = useDeclareLeaveRequest();

  const [uiSuccess, setUiSuccess] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [conflictData, setConflictData] = useState<{
    conflicts_approved: string[];
    conflicts_pending: string[];
  } | null>(null);
  const [showConflictDialog, setShowConflictDialog] = useState(false);

  const clearFeedback = () => {
    setUiError(null);
    setUiSuccess(null);
  };

  const handleDeclare = async (declaration: {
    date_start: string;
    date_end: string;
    motif_type: "maladie" | "cp" | "autre";
    motif_detail?: string;
  }) => {
    clearFeedback();
    setConflictData(null);

    try {
      const result = await declareMutation.mutateAsync({
        leave_type: "cp",
        date_start: declaration.date_start,
        date_end: declaration.date_end,
        reason: "Congé payé",
      });
      setUiSuccess("Demande de CP envoyée avec succès");
      setTimeout(() => onClose(), 1500);
      return { dates: result.dates, require_justificatif: false };
    } catch (err) {
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
        defaultMotif="cp"
        hideMotifSelector
      />

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
// MAIN: 2-CARD PORTAL
// ═══════════════════════════════════════════════════════════════════════════

export function CPPlaceholderTab() {
  const [declarationOpen, setDeclarationOpen] = useState(false);
  const [congesOpen, setCongesOpen] = useState(false);

  // Count pending CP requests for badge
  const { data: allRequests = [] } = useMyLeaveRequests(6);
  const cpPendingCount = allRequests.filter(
    (r) => r.leave_type === "cp" && r.status === "pending"
  ).length;

  return (
    <div className="space-y-4">
      {/* Card 1: Faire une demande de CP */}
      <Drawer open={declarationOpen} onOpenChange={setDeclarationOpen}>
        <DrawerTrigger asChild>
          <Card
            className="cursor-pointer hover:bg-muted/50 transition-colors active:scale-[0.98]"
            role="button"
            aria-label="Faire une demande de congé payé"
          >
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/20 flex items-center justify-center">
                  <Send className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="font-medium">Faire une demande</p>
                  <p className="text-sm text-muted-foreground">Demander un congé payé</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="border-b">
            <DrawerTitle>Demande de congé payé</DrawerTitle>
          </DrawerHeader>
          <CPDeclarationDrawerContent onClose={() => setDeclarationOpen(false)} />
        </DrawerContent>
      </Drawer>

      {/* Card 2: Mes congés */}
      <Drawer open={congesOpen} onOpenChange={setCongesOpen}>
        <DrawerTrigger asChild>
          <Card
            className="cursor-pointer hover:bg-muted/50 transition-colors active:scale-[0.98]"
            role="button"
            aria-label="Consulter mes congés payés"
          >
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/20 flex items-center justify-center">
                  <Palmtree className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="font-medium">Mes congés</p>
                  <p className="text-sm text-muted-foreground">Consulter mes demandes</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {cpPendingCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-emerald-100 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400"
                  >
                    {cpPendingCount}
                  </Badge>
                )}
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </DrawerTrigger>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="border-b">
            <DrawerTitle>Mes congés payés</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4">
            <MesCongesContent />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
