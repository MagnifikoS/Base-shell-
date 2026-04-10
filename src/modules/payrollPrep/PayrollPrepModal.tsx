/**
 * PAYROLL PREP MODAL — Modale affichant le tableau récapitulatif
 *
 * - Observations = state local (UI-only, non persisté) — EN BAS
 * - Remarques/Divers par salarié = state local (UI-only)
 * - Column visibility = state local (UI-only)
 */

import { useState, useEffect, useCallback } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PayrollPrepTable } from "./PayrollPrepTable";
import { usePayrollPrepData } from "./hooks/usePayrollPrepData";
import { generatePayrollPrepPdf } from "./utils/payrollPrepPdf";
import { type EmployeeLocalEdits, createDefaultEdits } from "./types";
import type { PayrollPrepColumnKey } from "./columnDefs";

interface PayrollPrepModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  yearMonth: string;
  establishmentId: string | null;
}

/**
 * Formate le label du mois avec timezone Paris
 */
function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const formatter = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
  const dateStr = `${year}-${String(month).padStart(2, "0")}-15T12:00:00`;
  return formatter.format(new Date(dateStr));
}

export function PayrollPrepModal({
  open,
  onOpenChange,
  yearMonth,
  establishmentId,
}: PayrollPrepModalProps) {
  const [observations, setObservations] = useState("");
  const [localEdits, setLocalEdits] = useState<Record<string, EmployeeLocalEdits>>({});
  const [hiddenEmployees, setHiddenEmployees] = useState<Set<string>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<PayrollPrepColumnKey>>(new Set());

  const { employees, isLoading, error } = usePayrollPrepData({
    yearMonth,
    establishmentId,
  });

  useEffect(() => {
    if (employees.length > 0) {
      setLocalEdits((prev) => {
        const next: Record<string, EmployeeLocalEdits> = {};
        for (const emp of employees) {
          next[emp.userId] = prev[emp.userId] || createDefaultEdits(emp.contractHoursWeekly);
        }
        return next;
      });
    }
  }, [employees]);

  const handleToggleHidden = useCallback((userId: string) => {
    setHiddenEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const handleToggleColumn = useCallback((col: PayrollPrepColumnKey) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  }, []);

  const handleUpdateEdit = useCallback(
    (userId: string, field: keyof EmployeeLocalEdits, value: string | number | null) => {
      setLocalEdits((prev) => ({
        ...prev,
        [userId]: {
          ...prev[userId],
          [field]: value,
        },
      }));
    },
    []
  );

  const handleGeneratePdf = async () => {
    if (employees.length === 0) return;

    const visibleEmployees = employees.filter((emp) => !hiddenEmployees.has(emp.userId));

    await generatePayrollPrepPdf({
      employees: visibleEmployees,
      localEdits,
      yearMonth,
      observations,
      hiddenColumns,
    });
  };

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>État préparatoire — {formatMonthLabel(yearMonth)}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto min-h-0">
          <PayrollPrepTable
            employees={employees}
            isLoading={isLoading}
            error={error}
            localEdits={localEdits}
            onUpdateEdit={handleUpdateEdit}
            hiddenEmployees={hiddenEmployees}
            onToggleHidden={handleToggleHidden}
            hiddenColumns={hiddenColumns}
            onToggleColumn={handleToggleColumn}
          />
        </div>

        <div className="flex-shrink-0 space-y-2 pt-4 border-t">
          <Label htmlFor="observations" className="text-sm font-medium">
            Observations (non enregistrées)
          </Label>
          <Textarea
            id="observations"
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            placeholder="Saisir vos observations pour ce mois..."
            className="h-20 resize-none"
          />
        </div>

        <div className="flex-shrink-0 flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <Button
            onClick={handleGeneratePdf}
            disabled={isLoading || employees.length === 0}
            className="gap-2"
          >
            <FileDown className="h-4 w-4" />
            Générer le PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
