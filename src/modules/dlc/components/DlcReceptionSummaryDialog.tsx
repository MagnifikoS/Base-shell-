/**
 * DLC V0 — Popup de synthèse DLC avant validation finale de la réception.
 *
 * Affiche les produits avec DLC dépassée ou proche, permet d'accepter ou refuser
 * chaque ligne individuellement. Le refus sera branché sur le module Retours (étape 3).
 *
 * Aucun impact sur RPC, stock, litiges. Pure UI gate.
 */

import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CalendarClock, Check, X, ShieldAlert } from "lucide-react";
import { computeDlcStatus, formatDlcDate, dlcUrgencyComparator } from "../lib/dlcCompute";
import type { DlcStatus } from "../types";

export interface DlcLineIssue {
  lineId: string;
  productName: string;
  dlcDate: string;
  quantity: number;
  unitLabel: string | null;
  warningDays: number | null;
  status: DlcStatus; // "warning" | "expired" (never "ok" here)
}

export type DlcLineDecision = "accepted" | "refused";

interface Props {
  open: boolean;
  onClose: () => void;
  issues: DlcLineIssue[];
  /** Called when the user confirms all decisions. Map lineId → decision */
  onConfirm: (decisions: Record<string, DlcLineDecision>) => void;
}

const STATUS_CONFIG: Record<"expired" | "warning", {
  label: string;
  sectionTitle: string;
  badgeClass: string;
  iconClass: string;
}> = {
  expired: {
    label: "Dépassée",
    sectionTitle: "DLC dépassée",
    badgeClass: "bg-red-100 text-red-700 border-red-200",
    iconClass: "text-red-500",
  },
  warning: {
    label: "Proche",
    sectionTitle: "DLC proche",
    badgeClass: "bg-amber-100 text-amber-700 border-amber-200",
    iconClass: "text-amber-500",
  },
};

export function DlcReceptionSummaryDialog({ open, onClose, issues, onConfirm }: Props) {
  // Per-line decision state: default all to "accepted"
  const [decisions, setDecisions] = useState<Record<string, DlcLineDecision>>({});

  // Reset decisions when dialog opens with new issues
  const issueKey = issues.map((i) => i.lineId).join(",");
  useMemo(() => {
    const initial: Record<string, DlcLineDecision> = {};
    for (const issue of issues) {
      initial[issue.lineId] = "accepted";
    }
    setDecisions(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey]);

  const toggleDecision = (lineId: string) => {
    setDecisions((prev) => ({
      ...prev,
      [lineId]: prev[lineId] === "accepted" ? "refused" : "accepted",
    }));
  };

  // Split into expired / warning, sorted by urgency
  const expired = useMemo(
    () =>
      issues
        .filter((i) => i.status === "expired")
        .sort((a, b) => dlcUrgencyComparator(
          { dlcDate: a.dlcDate, warningDays: a.warningDays },
          { dlcDate: b.dlcDate, warningDays: b.warningDays }
        )),
    [issues]
  );

  const warning = useMemo(
    () =>
      issues
        .filter((i) => i.status === "warning")
        .sort((a, b) => dlcUrgencyComparator(
          { dlcDate: a.dlcDate, warningDays: a.warningDays },
          { dlcDate: b.dlcDate, warningDays: b.warningDays }
        )),
    [issues]
  );

  const refusedCount = Object.values(decisions).filter((d) => d === "refused").length;

  const handleConfirm = () => {
    onConfirm(decisions);
  };

  if (issues.length === 0) return null;

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Contrôle DLC avant réception
          </AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            {issues.length} produit{issues.length > 1 ? "s" : ""} avec une DLC critique.
            Choisissez d'accepter ou refuser chaque produit.
          </p>
        </AlertDialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Expired section */}
          {expired.length > 0 && (
            <DlcSection
              type="expired"
              items={expired}
              decisions={decisions}
              onToggle={toggleDecision}
            />
          )}

          {/* Warning section */}
          {warning.length > 0 && (
            <DlcSection
              type="warning"
              items={warning}
              decisions={decisions}
              onToggle={toggleDecision}
            />
          )}
        </div>

        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          {refusedCount > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {refusedCount} produit{refusedCount > 1 ? "s" : ""} refusé{refusedCount > 1 ? "s" : ""} → retour créé
            </p>
          )}
          <div className="flex gap-2 w-full">
            <AlertDialogCancel className="flex-1">Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} className="flex-1">
              Continuer la réception
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------- Sub-components ----------

function DlcSection({
  type,
  items,
  decisions,
  onToggle,
}: {
  type: "expired" | "warning";
  items: DlcLineIssue[];
  decisions: Record<string, DlcLineDecision>;
  onToggle: (lineId: string) => void;
}) {
  const config = STATUS_CONFIG[type];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className={`h-4 w-4 ${config.iconClass}`} />
        <span className="text-sm font-semibold">{config.sectionTitle}</span>
        <Badge variant="outline" className={`text-[10px] ${config.badgeClass}`}>
          {items.length}
        </Badge>
      </div>

      <div className="space-y-1.5">
        {items.map((item) => {
          const decision = decisions[item.lineId] ?? "accepted";
          const isRefused = decision === "refused";

          return (
            <div
              key={item.lineId}
              className={`flex items-center gap-2 p-2.5 rounded-lg border transition-colors ${
                isRefused
                  ? "bg-red-50/80 border-red-200"
                  : type === "expired"
                    ? "bg-red-50/40 border-red-100"
                    : "bg-amber-50/40 border-amber-100"
              }`}
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className={`text-sm font-medium truncate ${isRefused ? "line-through text-muted-foreground" : ""}`}>
                  {item.productName}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" />
                    {formatDlcDate(item.dlcDate)}
                  </span>
                  <span>·</span>
                  <span>
                    {item.quantity} {item.unitLabel ?? ""}
                  </span>
                </div>
              </div>

              <Button
                variant={isRefused ? "destructive" : "outline"}
                size="sm"
                className="shrink-0 h-8 text-xs gap-1"
                onClick={() => onToggle(item.lineId)}
              >
                {isRefused ? (
                  <>
                    <X className="h-3.5 w-3.5" />
                    Refusé
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Accepté
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
