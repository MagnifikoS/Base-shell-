/**
 * PaymentPopover -- Popover for partial payment support.
 *
 * Allows the user to choose between:
 * - Totalite (full payment)
 * - Montant partiel (partial payment with input)
 * - Non paye (no payment)
 *
 * Used for both "Virement" and "Especes" columns in PayrollTable.
 */

import { useState, useCallback, useEffect } from "react";
import { Check, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatEuros } from "./payrollHelpers";
import { getPaymentBadgeState } from "./payrollPaymentUtils";

/* ─────────────────────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────────────────────*/

export interface PaymentPopoverProps {
  type: "net" | "cash";
  employeeName: string;
  totalAmount: number;
  currentPaid: boolean;
  currentAmountPaid: number | null;
  onSave: (paid: boolean, amountPaid: number | null) => void;
  canWrite: boolean;
}

type PaymentMode = "full" | "partial" | "unpaid";

/**
 * Get the initial radio mode from current payment state.
 */
function getInitialMode(
  paid: boolean,
  amountPaid: number | null,
  totalAmount: number
): PaymentMode {
  if (!paid) return "unpaid";
  if (amountPaid === null) return "full";
  if (amountPaid >= totalAmount) return "full";
  return "partial";
}

/* ─────────────────────────────────────────────────────────────────────────────
 * PaymentBadgeWithPopover
 * ────────────────────────────────────────────────────────────────────────────*/

export function PaymentBadgeWithPopover({
  type,
  employeeName,
  totalAmount,
  currentPaid,
  currentAmountPaid,
  onSave,
  canWrite,
}: PaymentPopoverProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PaymentMode>(() =>
    getInitialMode(currentPaid, currentAmountPaid, totalAmount)
  );
  const [partialInput, setPartialInput] = useState<string>(() =>
    currentAmountPaid !== null ? currentAmountPaid.toFixed(2) : ""
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset local state when popover opens
  useEffect(() => {
    if (open) {
      setMode(getInitialMode(currentPaid, currentAmountPaid, totalAmount));
      setPartialInput(currentAmountPaid !== null ? currentAmountPaid.toFixed(2) : "");
      setValidationError(null);
    }
  }, [open, currentPaid, currentAmountPaid, totalAmount]);

  const handleSave = useCallback(() => {
    if (mode === "unpaid") {
      onSave(false, null);
      setOpen(false);
      return;
    }

    if (mode === "full") {
      onSave(true, null);
      setOpen(false);
      return;
    }

    // mode === "partial"
    const parsed = parseFloat(partialInput);
    if (isNaN(parsed) || parsed < 0) {
      setValidationError("Le montant doit etre positif");
      return;
    }
    if (parsed > totalAmount) {
      setValidationError(`Le montant ne peut pas depasser ${formatEuros(totalAmount)}`);
      return;
    }

    setValidationError(null);
    onSave(true, parsed);
    setOpen(false);
  }, [mode, partialInput, totalAmount, onSave]);

  // Visual state for the badge
  const badgeState = getPaymentBadgeState(currentPaid, currentAmountPaid, totalAmount);
  const label = type === "net" ? "Virement" : "Especes";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!canWrite}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-all",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
            canWrite && "cursor-pointer hover:opacity-80",
            !canWrite && "cursor-default",
            badgeState === "full" &&
              "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
            badgeState === "partial" &&
              "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
            badgeState === "unpaid" &&
              "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          )}
          data-testid={`payment-badge-${type}`}
        >
          {badgeState === "unpaid" ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
          <span>
            {badgeState === "full" && "Paye"}
            {badgeState === "partial" &&
              currentAmountPaid !== null &&
              formatEuros(currentAmountPaid)}
            {badgeState === "unpaid" && "Non paye"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="center" sideOffset={8}>
        <div className="space-y-4">
          {/* Header */}
          <div>
            <h4 className="text-sm font-semibold">
              {label} pour {employeeName}
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              {type === "net" ? "Net a payer" : "Especes"} : {formatEuros(totalAmount)}
            </p>
          </div>

          {/* Radio group */}
          <RadioGroup
            value={mode}
            onValueChange={(v) => {
              setMode(v as PaymentMode);
              setValidationError(null);
            }}
            className="space-y-2"
          >
            {/* Full payment */}
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="full" id={`payment-${type}-full`} />
              <Label htmlFor={`payment-${type}-full`} className="text-sm cursor-pointer">
                Totalite ({formatEuros(totalAmount)})
              </Label>
            </div>

            {/* Partial payment */}
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="partial" id={`payment-${type}-partial`} />
                <Label htmlFor={`payment-${type}-partial`} className="text-sm cursor-pointer">
                  Montant partiel
                </Label>
              </div>
              {mode === "partial" && (
                <div className="ml-6 space-y-1">
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`payment-${type}-input`}
                      className="text-xs text-muted-foreground shrink-0"
                    >
                      Montant verse :
                    </Label>
                    <Input
                      id={`payment-${type}-input`}
                      type="number"
                      min={0}
                      max={totalAmount}
                      step={0.01}
                      value={partialInput}
                      onChange={(e) => {
                        setPartialInput(e.target.value);
                        setValidationError(null);
                      }}
                      className="w-28 h-8 text-sm text-right font-mono px-2"
                      data-testid={`payment-amount-input-${type}`}
                      autoFocus
                    />
                    <span className="text-xs text-muted-foreground">EUR</span>
                  </div>
                  {validationError && (
                    <p className="text-xs text-destructive" data-testid="payment-validation-error">
                      {validationError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Not paid */}
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="unpaid" id={`payment-${type}-unpaid`} />
              <Label htmlFor={`payment-${type}-unpaid`} className="text-sm cursor-pointer">
                Non paye
              </Label>
            </div>
          </RadioGroup>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button size="sm" onClick={handleSave} data-testid={`payment-save-${type}`}>
              Valider
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
