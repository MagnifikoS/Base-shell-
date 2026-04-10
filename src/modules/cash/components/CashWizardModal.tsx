/**
 * CashWizardModal — 5-step quick entry for daily cash.
 * Steps: CB → Espèces → Courses/Maintenance → Acompte → Résumé
 * Centered dialog, compact and aesthetic.
 */

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronLeft,
  Check,
  Loader2,
  CreditCard,
  Banknote,
  ShoppingCart,
  Wrench,
  UserRound,
  Truck,
} from "lucide-react";
import { useCashWizard } from "../hooks/useCashWizard";
import { useCashDay } from "../hooks/useCashDay";
import { useEstablishmentProfiles } from "../hooks/useEstablishmentProfiles";
import { calculateCA, formatEur, parseEurInput } from "../utils/money";
import type { CashDayFormValues, WizardStep } from "../utils/types";
import type { CashDayReport } from "../utils/types";

interface CashWizardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayDate: string;
  establishmentId: string;
  existingReport: CashDayReport | null;
}

const STEP_CONFIG: Record<
  WizardStep,
  { title: string; description: string }
> = {
  cb: { title: "Carte bancaire", description: "Montant total CB du jour" },
  cash: { title: "Espèces", description: "Montant total espèces du jour" },
  delivery: { title: "Livraison", description: "Montant livraison du jour" },
  expenses: { title: "Dépenses", description: "Courses et maintenance du jour" },
  advance: { title: "Acompte salarié", description: "Un acompte a-t-il été versé ?" },
  summary: { title: "Résumé", description: "Vérifiez avant de valider" },
};

export function CashWizardModal({
  open,
  onOpenChange,
  dayDate,
  establishmentId,
  existingReport,
}: CashWizardModalProps) {
  const prefill = existingReport
    ? {
        cb_eur: existingReport.cb_eur ?? 0,
        cash_eur: existingReport.cash_eur ?? 0,
        delivery_eur: existingReport.delivery_eur ?? 0,
        courses_eur: existingReport.courses_eur ?? 0,
        maintenance_eur: existingReport.maintenance_eur ?? 0,
        advance_eur: existingReport.advance_eur ?? 0,
        advance_employee_id: existingReport.advance_employee_id ?? null,
      }
    : undefined;

  const wizard = useCashWizard(prefill);
  const { save, isSaving } = useCashDay({ establishmentId, dayDate });
  const { data: profiles } = useEstablishmentProfiles();

  const [wantsAdvance, setWantsAdvance] = useState(
    existingReport ? (existingReport.advance_eur ?? 0) > 0 : false
  );

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        wizard.reset(prefill);
        setWantsAdvance(existingReport ? (existingReport.advance_eur ?? 0) > 0 : false);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, wizard, prefill, existingReport]
  );

  const handleConfirm = useCallback(() => {
    const formValues: CashDayFormValues = {
      cb_eur: wizard.values.cb_eur,
      cash_eur: wizard.values.cash_eur,
      delivery_eur: wizard.values.delivery_eur,
      courses_eur: wizard.values.courses_eur,
      maintenance_eur: wizard.values.maintenance_eur,
      shortage_eur: existingReport?.shortage_eur ?? 0,
      advance_eur: wantsAdvance ? wizard.values.advance_eur : 0,
      advance_employee_id: wantsAdvance ? wizard.values.advance_employee_id : null,
      note: existingReport?.note ?? "",
    };

    save(formValues, {
      onSuccess: () => handleClose(false),
    });
  }, [wizard.values, existingReport, wantsAdvance, save, handleClose]);

  const caWizard = calculateCA({ ...wizard.values, shortage_eur: existingReport?.shortage_eur ?? 0 });
  const advanceAmount = wantsAdvance ? wizard.values.advance_eur : 0;
  const balanceWizard =
    caWizard -
    wizard.values.maintenance_eur -
    (existingReport?.shortage_eur ?? 0) -
    advanceAmount;

  const stepConfig = STEP_CONFIG[wizard.step];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm rounded-2xl p-0 gap-0 overflow-hidden">
        {/* Progress bar */}
        <div className="px-5 pt-5">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{
                width: `${((wizard.stepIndex + 1) / wizard.totalSteps) * 100}%`,
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center mt-1.5">
            {wizard.stepIndex + 1} / {wizard.totalSteps}
          </p>
        </div>

        <DialogHeader className="px-5 pt-3 pb-1 text-center">
          <DialogTitle className="text-lg">{stepConfig.title}</DialogTitle>
          <DialogDescription className="text-sm">{stepConfig.description}</DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-5 space-y-5">
          {/* Step content */}
          {wizard.step === "cb" && (
            <StepAmount
              icon={CreditCard}
              label="Montant CB"
              value={wizard.values.cb_eur}
              onChange={(v) => wizard.updateField("cb_eur", v)}
            />
          )}

          {wizard.step === "cash" && (
            <StepAmount
              icon={Banknote}
              label="Montant espèces"
              value={wizard.values.cash_eur}
              onChange={(v) => wizard.updateField("cash_eur", v)}
            />
          )}

          {wizard.step === "delivery" && (
            <StepAmount
              icon={Truck}
              label="Montant livraison"
              value={wizard.values.delivery_eur}
              onChange={(v) => wizard.updateField("delivery_eur", v)}
            />
          )}

          {wizard.step === "expenses" && (
            <div className="space-y-4">
              <StepAmount
                icon={ShoppingCart}
                label="Courses"
                value={wizard.values.courses_eur}
                onChange={(v) => wizard.updateField("courses_eur", v)}
              />
              <StepAmount
                icon={Wrench}
                label="Maintenance"
                value={wizard.values.maintenance_eur}
                onChange={(v) => wizard.updateField("maintenance_eur", v)}
              />
            </div>
          )}

          {wizard.step === "advance" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant={wantsAdvance ? "default" : "outline"}
                  size="sm"
                  className="flex-1 rounded-xl"
                  onClick={() => setWantsAdvance(true)}
                >
                  Oui
                </Button>
                <Button
                  variant={!wantsAdvance ? "default" : "outline"}
                  size="sm"
                  className="flex-1 rounded-xl"
                  onClick={() => {
                    setWantsAdvance(false);
                    wizard.updateField("advance_eur", 0);
                    wizard.updateField("advance_employee_id", null);
                  }}
                >
                  Non
                </Button>
              </div>

              {wantsAdvance && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-sm">Salarié</Label>
                    <Select
                      value={wizard.values.advance_employee_id ?? ""}
                      onValueChange={(v) => wizard.updateField("advance_employee_id", v || null)}
                    >
                      <SelectTrigger className="rounded-xl">
                        <SelectValue placeholder="Choisir un salarié" />
                      </SelectTrigger>
                      <SelectContent>
                        {(profiles ?? []).map((p) => (
                          <SelectItem key={p.user_id} value={p.user_id}>
                            {p.full_name || p.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <StepAmount
                    icon={UserRound}
                    label="Montant acompte"
                    value={wizard.values.advance_eur}
                    onChange={(v) => wizard.updateField("advance_eur", v)}
                  />
                </div>
              )}
            </div>
          )}

          {wizard.step === "summary" && (
            <div className="space-y-2.5 rounded-xl bg-muted/20 p-4">
              <SummaryRow label="CB" value={wizard.values.cb_eur} />
              <SummaryRow label="Espèces" value={wizard.values.cash_eur} />
              <SummaryRow label="Livraison" value={wizard.values.delivery_eur} />
              <div className="border-t border-dashed my-1" />
              <SummaryRow label="Courses" value={wizard.values.courses_eur} negative />
              <SummaryRow label="Maintenance" value={wizard.values.maintenance_eur} negative />
              {(existingReport?.shortage_eur ?? 0) > 0 && (
                <SummaryRow label="Manque" value={existingReport?.shortage_eur ?? 0} negative />
              )}
              {wantsAdvance && wizard.values.advance_eur > 0 && (
                <SummaryRow label="Acompte" value={wizard.values.advance_eur} negative />
              )}
              <div className="border-t my-1" />
              <div className="flex justify-between items-center">
                <span className="font-semibold text-sm">CA brut</span>
                <span className="font-bold tabular-nums">{formatEur(caWizard)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-sm">Solde net</span>
                <span
                  className={`font-bold tabular-nums ${balanceWizard >= 0 ? "" : "text-destructive"}`}
                >
                  {formatEur(balanceWizard)}
                </span>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-2">
            {!wizard.isFirst && (
              <Button variant="outline" onClick={wizard.back} className="flex-1 rounded-xl" size="sm" disabled={isSaving}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Retour
              </Button>
            )}

            {wizard.isLast ? (
              <Button className="flex-1 rounded-xl" size="sm" onClick={handleConfirm} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1 h-4 w-4" />
                )}
                Confirmer
              </Button>
            ) : (
              <Button className="flex-1 rounded-xl" size="sm" onClick={wizard.next}>
                Valider
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══ Internal sub-components ═══ */

function StepAmount({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5 flex flex-col items-center">
      <Label className="flex items-center gap-2 text-sm font-medium self-start">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </Label>
      <Input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={value || ""}
        onChange={(e) => onChange(parseEurInput(e.target.value))}
        placeholder="0.00"
        className="text-center text-2xl h-14 font-semibold tabular-nums rounded-xl max-w-[200px]"
        autoFocus
      />
    </div>
  );
}

function SummaryRow({
  label,
  value,
  negative,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${negative ? "text-destructive" : ""}`}>
        {negative && value > 0 ? "−" : ""}
        {formatEur(value)}
      </span>
    </div>
  );
}
