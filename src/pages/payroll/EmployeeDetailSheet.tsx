/**
 * EmployeeDetailSheet -- Side drawer showing payroll details for a single employee.
 * Includes contract info, CP, extras (R-Extra), absences, deductions, total,
 * and an editable payment section with status indicators.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Clock, Calendar, Info, Check, X, Banknote } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { cn } from "@/lib/utils";
import { usePayrollValidation } from "@/hooks/payroll/usePayrollValidation";
import {
  formatMinutesToHHMM,
  computeDueBreakdownSimplified,
  computeRExtraDecision,
  type PayrollValidationFlags,
} from "@/lib/payroll/payroll.compute";
import { formatDueMinutesToHHMM } from "@/lib/payroll/due.compute";
import type { PayrollEmployeeData } from "@/hooks/payroll/usePayrollMonthData";
import { formatEuros } from "./payrollHelpers";

/* ─────────────────────────────────────────────────────────────────────────────
 * Payment status badge (reused in the drawer)
 * ────────────────────────────────────────────────────────────────────────────*/

function PaymentStatusBadgeButton({
  paid,
  canWrite,
  isPending,
  onToggle,
  label,
  amount,
}: {
  paid: boolean;
  canWrite: boolean;
  isPending: boolean;
  onToggle: () => void;
  label: string;
  amount: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-base font-semibold tabular-nums">{formatEuros(amount)}</p>
      </div>
      <button
        type="button"
        disabled={!canWrite || isPending}
        onClick={onToggle}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
          canWrite && !isPending && "cursor-pointer hover:opacity-80",
          (!canWrite || isPending) && "cursor-default opacity-70",
          paid
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
            : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
        )}
      >
        {paid ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        <span>{paid ? "Payé" : "Non payé"}</span>
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Component
 * ────────────────────────────────────────────────────────────────────────────*/

interface EmployeeDetailSheetProps {
  employee: PayrollEmployeeData | null;
  onClose: () => void;
  validationFlags: PayrollValidationFlags;
  /** R-Extra balance from backend (SSOT: all-time calculated) */
  rextraBalanceMinutes: number;
  establishmentId: string | null;
  yearMonth: string;
  canWrite: boolean;
}

export function EmployeeDetailSheet({
  employee,
  onClose,
  validationFlags,
  rextraBalanceMinutes,
  establishmentId,
  yearMonth,
  canWrite,
}: EmployeeDetailSheetProps) {
  const validationMutation = usePayrollValidation();

  // State for extras details modal
  const [showExtrasDetails, setShowExtrasDetails] = useState(false);

  // State for collapsible sections
  const [cpOpen, setCpOpen] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [absencesOpen, setAbsencesOpen] = useState(false);
  const [deductionsOpen, setDeductionsOpen] = useState(false);

  // REFONTE R-EXTRA: Montant paid on salary (local input)
  const [partialExtrasInput, setPartialExtrasInput] = useState<string>("");
  const [hasPartialInputChanged, setHasPartialInputChanged] = useState(false);

  const flags = validationFlags;

  if (!employee) return null;

  const { line } = employee;

  // Compute breakdown using simplified engine
  const breakdown = computeDueBreakdownSimplified(line, flags);

  // Parse input for calculations
  const parsedInputValue =
    parseFloat(partialExtrasInput || (flags.extrasPaidEur?.toFixed(2) ?? "0")) || 0;

  // Compute R-Extra decision using engine (based on current month data only)
  const rExtraDecision = computeRExtraDecision(
    line,
    hasPartialInputChanged ? parsedInputValue : flags.extrasPaidEur
  );

  // Display values from engine
  const displayedInputValue = hasPartialInputChanged
    ? partialExtrasInput
    : (flags.extrasPaidEur?.toFixed(2) ?? "0");

  // Handler: Valider le paiement des extras
  const handleValidateExtras = async () => {
    if (!establishmentId || !canWrite) return;

    const decision = computeRExtraDecision(line, parsedInputValue);

    await validationMutation.mutateAsync({
      establishmentId,
      userId: employee.userId,
      yearMonth,
      includeExtras: decision.paidEur > 0,
      includeAbsences: flags.includeAbsences,
      includeDeductions: flags.includeDeductions,
      cashPaid: flags.cashPaid,
      netPaid: flags.netPaid,
      extrasPaidEur: decision.paidEur,
      netAmountPaid: flags.netAmountPaid,
      cashAmountPaid: flags.cashAmountPaid,
    });

    setHasPartialInputChanged(false);
  };

  const handleToggle = (field: keyof PayrollValidationFlags, value: boolean) => {
    if (!establishmentId || !canWrite) return;

    validationMutation.mutate({
      establishmentId,
      userId: employee.userId,
      yearMonth,
      includeExtras: field === "includeExtras" ? value : flags.includeExtras,
      includeAbsences: field === "includeAbsences" ? value : flags.includeAbsences,
      includeDeductions: field === "includeDeductions" ? value : flags.includeDeductions,
      cashPaid: field === "cashPaid" ? value : flags.cashPaid,
      netPaid: field === "netPaid" ? value : flags.netPaid,
      extrasPaidEur: flags.extrasPaidEur,
      netAmountPaid: flags.netAmountPaid,
      cashAmountPaid: flags.cashAmountPaid,
    });
  };

  const isPending = validationMutation.isPending;

  // Payment status derivation (partial-payment aware)
  const hasCash = line.cashAmountComputed > 0;
  const totalDue = line.net_salary + (hasCash ? line.cashAmountComputed : 0);

  // Compute actual paid amounts (accounting for partial payments)
  const netPaidAmount = !flags.netPaid
    ? 0
    : flags.netAmountPaid !== null
      ? Math.min(flags.netAmountPaid, line.net_salary)
      : line.net_salary;
  const cashPaidAmount = !flags.cashPaid
    ? 0
    : flags.cashAmountPaid !== null
      ? Math.min(flags.cashAmountPaid, line.cashAmountComputed)
      : line.cashAmountComputed;
  const totalPaid = netPaidAmount + cashPaidAmount;
  const totalRemaining = totalDue - totalPaid;

  // Full = all channels fully paid (no partial amounts below total)
  const netFullyPaid =
    flags.netPaid && (flags.netAmountPaid === null || flags.netAmountPaid >= line.net_salary);
  const cashFullyPaid =
    !hasCash ||
    (flags.cashPaid &&
      (flags.cashAmountPaid === null || flags.cashAmountPaid >= line.cashAmountComputed));
  const isFullyPaid = netFullyPaid && cashFullyPaid;
  const isPartiallyPaid = !isFullyPaid && totalPaid > 0;

  return (
    <Sheet open={!!employee} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-xl">{employee.fullName}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {/* Section 1: Contrat & Heures */}
          <div className="bg-muted/40 rounded-lg p-4 space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Contrat & Heures
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Salaire total</p>
                <p className="text-base font-semibold tabular-nums">
                  {formatEuros(line.totalSalary)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Taux horaire</p>
                <p className="text-base font-semibold tabular-nums">
                  {formatEuros(line.hourlyRateOperational)}/h
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  R-Extra{" "}
                  <HelpTooltip text="Heures supplémentaires réelles, calculées automatiquement" />
                </p>
                <p className="text-base font-semibold font-mono text-emerald-600 dark:text-emerald-400">
                  {formatMinutesToHHMM(rextraBalanceMinutes)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">H. base (mois)</p>
                <p className="text-base font-semibold font-mono">
                  {formatMinutesToHHMM(line.baseMinutesMonth)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">H. effectuées</p>
                <p className="text-base font-semibold font-mono">
                  {formatMinutesToHHMM(line.workedMinutesMonth)}
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: Paiement (editable) */}
          <div
            className={cn(
              "rounded-lg p-4 space-y-4",
              isFullyPaid
                ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800"
                : isPartiallyPaid
                  ? "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800"
                  : "bg-gray-50 dark:bg-gray-900/40 border border-border"
            )}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
                <Banknote className="h-4 w-4" />
                Paiement
              </h4>
              {/* Overall status badge */}
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  isFullyPaid
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                    : isPartiallyPaid
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                      : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    isFullyPaid && "bg-emerald-500",
                    isPartiallyPaid && "bg-amber-500",
                    !isFullyPaid && !isPartiallyPaid && "bg-gray-400"
                  )}
                />
                {isFullyPaid
                  ? "Entièrement payé"
                  : isPartiallyPaid
                    ? "Partiellement payé"
                    : "Non payé"}
              </span>
            </div>

            {/* Net salary (virement) */}
            <PaymentStatusBadgeButton
              paid={flags.netPaid}
              canWrite={canWrite}
              isPending={isPending}
              onToggle={() => handleToggle("netPaid", !flags.netPaid)}
              label="Salaire net (virement)"
              amount={line.net_salary}
            />

            {/* Cash (espèces) */}
            {hasCash && (
              <PaymentStatusBadgeButton
                paid={flags.cashPaid}
                canWrite={canWrite}
                isPending={isPending}
                onToggle={() => handleToggle("cashPaid", !flags.cashPaid)}
                label="Espèces"
                amount={line.cashAmountComputed}
              />
            )}

            {/* Remaining total */}
            <div className="border-t pt-3 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Reste à payer</span>
                <span
                  className={cn(
                    "text-lg font-bold tabular-nums",
                    totalRemaining > 0
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {formatEuros(totalRemaining)}
                </span>
              </div>
              {totalPaid > 0 && (
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground">Déjà payé</span>
                  <span className="text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatEuros(totalPaid)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Congés Payés - Collapsible */}
          <Collapsible open={cpOpen} onOpenChange={setCpOpen}>
            <div className="bg-sky-50 dark:bg-sky-950/30 rounded-lg overflow-hidden">
              <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-sky-100/50 dark:hover:bg-sky-900/30 transition-colors">
                <h4 className="text-sm font-semibold text-sky-700 dark:text-sky-400 uppercase tracking-wide flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Congés Payés
                </h4>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-sky-600 dark:text-sky-400">
                    {line.cpDays}j pris
                  </span>
                  {cpOpen ? (
                    <ChevronUp className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                  )}
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-3">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">CP pris (mois)</p>
                      <p className="text-base font-semibold text-sky-600 dark:text-sky-400">
                        {line.cpDays}j
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Solde N-1{" "}
                        <HelpTooltip text="Congés payés de l'année précédente, à solder avant le 31 décembre" />
                      </p>
                      <p className="text-base font-semibold text-sky-500 dark:text-sky-400">
                        {(line.cpN1 ?? 0) > 0 || (line.cpRemainingN1 ?? 0) !== 0
                          ? (line.cpRemainingN1 ?? 0).toFixed(1)
                          : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Solde N</p>
                      <p
                        className={`text-base font-semibold ${(line.cpRemainingN ?? 0) < 0 ? "text-destructive" : "text-sky-500 dark:text-sky-400"}`}
                      >
                        {(line.cpN ?? 0) > 0 || (line.cpRemainingN ?? 0) !== 0
                          ? (line.cpRemainingN ?? 0).toFixed(1)
                          : "-"}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground italic">
                    Les CP sont payés, pas de déduction
                  </p>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          {/* Section 4: Ajustements avec toggles */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Ajustements du mois
            </h4>

            {/* Extras - REFONTE R-EXTRA: Collapsible */}
            <Collapsible open={extrasOpen} onOpenChange={setExtrasOpen}>
              <div className="border rounded-lg overflow-hidden">
                <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    Heures supplémentaires
                    <HelpTooltip text="Heures supplémentaires planifiées au-delà de 35h/semaine" />
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold font-mono text-emerald-600 dark:text-emerald-400">
                      {formatMinutesToHHMM(rExtraDecision.detectedMinutes)} /{" "}
                      {formatEuros(rExtraDecision.detectedEur)}
                    </span>
                    {extrasOpen ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-3 pb-3 space-y-3">
                    <div className="bg-muted/30 rounded-md p-2 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Détectés (mois)</span>
                        <span className="font-mono font-semibold">
                          {formatMinutesToHHMM(rExtraDecision.detectedMinutes)} /{" "}
                          {formatEuros(rExtraDecision.detectedEur)}
                        </span>
                      </div>
                      {rExtraDecision.paidEur > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-emerald-600 dark:text-emerald-400">
                            Payé sur salaire
                          </span>
                          <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                            -{formatEuros(rExtraDecision.paidEur)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs border-t pt-1.5">
                        <span className="font-medium">Solde R-Extra</span>
                        <span className="font-mono font-bold text-primary">
                          {formatMinutesToHHMM(rExtraDecision.rExtraMinutes)} /{" "}
                          {formatEuros(rExtraDecision.rExtraEur)}
                        </span>
                      </div>
                    </div>

                    {/* Payment input */}
                    {rExtraDecision.totalAvailableMinutes > 0 && (
                      <div className="bg-muted/50 rounded-lg p-3 space-y-3">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                          Paiement partiel
                        </p>
                        <div className="flex items-center gap-2">
                          <Label
                            htmlFor={`extras-pay-${employee.userId}`}
                            className="text-sm whitespace-nowrap"
                          >
                            Payer sur salaire :
                          </Label>
                          <Input
                            id={`extras-pay-${employee.userId}`}
                            type="number"
                            min={0}
                            max={rExtraDecision.totalAvailableEur}
                            step={0.01}
                            value={displayedInputValue}
                            onChange={(e) => {
                              setPartialExtrasInput(e.target.value);
                              setHasPartialInputChanged(true);
                            }}
                            disabled={!canWrite || isPending}
                            className="w-28 h-8 text-sm text-right font-mono px-2"
                          />
                          <span className="text-xs text-muted-foreground">
                            / {formatEuros(rExtraDecision.totalAvailableEur)}
                          </span>
                        </div>

                        {hasPartialInputChanged && (
                          <Button
                            size="sm"
                            onClick={handleValidateExtras}
                            disabled={isPending}
                            className="w-full"
                          >
                            {isPending ? "Validation..." : "Valider"}
                          </Button>
                        )}

                        <p className="text-xs text-muted-foreground italic">
                          Le reste ({formatEuros(rExtraDecision.rExtraEur)}) sera reporté au mois
                          suivant
                        </p>
                      </div>
                    )}

                    {/* Details button */}
                    <button
                      type="button"
                      onClick={() => setShowExtrasDetails(true)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span>Voir détails</span>
                      <Info className="h-3 w-3" />
                    </button>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* Extras Details Modal */}
            <Dialog open={showExtrasDetails} onOpenChange={setShowExtrasDetails}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    Détails des heures supplémentaires
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="border rounded-lg p-3 bg-muted/30">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Extra planning</span>
                      <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400">
                        {formatMinutesToHHMM(line.planningExtraMinutesMonth)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Heures travaillées au-delà du contrat (base:{" "}
                      {formatMinutesToHHMM(line.baseMinutesMonth)}, effectué:{" "}
                      {formatMinutesToHHMM(line.workedMinutesMonth)})
                    </p>
                  </div>
                  <div className="border rounded-lg p-3 bg-muted/30">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Extra hors planning</span>
                      <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400">
                        {formatMinutesToHHMM(line.extraMinutes)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Heures validées via badgeuse (départs tardifs)
                    </p>
                    {line.extraMinutes > 0 && (
                      <div className="mt-2 pt-2 border-t border-dashed">
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Info className="h-3 w-3" />
                          Voir Gestion Personnel - Présence pour le détail par jour
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex justify-between items-center font-medium">
                      <span>Total heures supp.</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                        {formatMinutesToHHMM(breakdown.extrasMinutesRaw)} = +
                        {formatEuros(breakdown.extrasAmountRaw)}
                      </span>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Absences - Collapsible */}
            <Collapsible open={absencesOpen} onOpenChange={setAbsencesOpen}>
              <div className="border rounded-lg overflow-hidden">
                <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-destructive" />
                    Absences (hors CP)
                  </span>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-sm font-semibold ${flags.includeAbsences ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {line.absenceDaysTotal}j / -{formatEuros(line.absenceAmount)}
                    </span>
                    {absencesOpen ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-3 pb-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Inclure dans le calcul</span>
                      <Switch
                        checked={flags.includeAbsences}
                        onCheckedChange={(v) => handleToggle("includeAbsences", v)}
                        disabled={!canWrite || isPending}
                        className="h-5 w-9 data-[state=checked]:bg-destructive data-[state=unchecked]:bg-input [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                      />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {line.absenceDaysTotal} jour
                        {line.absenceDaysTotal > 1 ? "s" : ""}
                      </span>
                      <span
                        className={`font-semibold ${flags.includeAbsences ? "text-destructive" : "text-muted-foreground line-through"}`}
                      >
                        -{formatEuros(line.absenceAmount)}
                      </span>
                    </div>
                    {(line.absenceDeclaredDays > 0 || line.absenceBadgeDays > 0) && (
                      <div className="bg-muted/30 rounded-md p-2 space-y-1 text-xs">
                        {line.absenceDeclaredDays > 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Déclarées (planning)</span>
                            <span className="font-mono">{line.absenceDeclaredDays}j</span>
                          </div>
                        )}
                        {line.absenceBadgeDays > 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Non badgées (auto)</span>
                            <span className="font-mono">{line.absenceBadgeDays}j</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* Deductions (Retards + Départs anticipés) - Collapsible */}
            <Collapsible open={deductionsOpen} onOpenChange={setDeductionsOpen}>
              <div className="border rounded-lg overflow-hidden">
                <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    Retards & Départs anticipés
                  </span>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-sm font-semibold font-mono ${flags.includeDeductions ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                    >
                      {formatDueMinutesToHHMM(breakdown.deductionMinutesRaw)} / -
                      {formatEuros(breakdown.deductionAmountRaw)}
                    </span>
                    {deductionsOpen ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-3 pb-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Déduire du salaire</span>
                      <Switch
                        checked={flags.includeDeductions}
                        onCheckedChange={(v) => handleToggle("includeDeductions", v)}
                        disabled={!canWrite || isPending}
                        className="h-5 w-9 data-[state=checked]:bg-amber-600 dark:data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-input [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                      />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground font-mono">
                        {formatDueMinutesToHHMM(breakdown.deductionMinutesRaw)}
                      </span>
                      <span
                        className={`font-semibold ${flags.includeDeductions ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground line-through"}`}
                      >
                        -{formatEuros(breakdown.deductionAmountRaw)}
                      </span>
                    </div>

                    {(line.lateMinutesTotal > 0 || line.earlyDepartureMinutesTotal > 0) && (
                      <div className="bg-muted/30 rounded-md p-2 space-y-1 text-xs">
                        {line.lateMinutesTotal > 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Retards</span>
                            <span className="font-mono">
                              {formatDueMinutesToHHMM(line.lateMinutesTotal)}
                            </span>
                          </div>
                        )}
                        {line.earlyDepartureMinutesTotal > 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Départs anticipés</span>
                            <span className="font-mono">
                              {formatDueMinutesToHHMM(line.earlyDepartureMinutesTotal)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {breakdown.deductionMinutesRaw === 0 && (
                      <p className="text-sm text-muted-foreground italic">
                        Aucune déduction ce mois
                      </p>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>

          {/* Section 5: Total + Fermer */}
          <div className="border-t pt-4 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold">Salaire total ajusté</span>
              <span className="text-2xl font-bold tabular-nums">
                {formatEuros(breakdown.adjustedGross)}
              </span>
            </div>
            <Button className="w-full" onClick={onClose} disabled={isPending}>
              Fermer
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
