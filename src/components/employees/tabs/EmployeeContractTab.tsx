import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, UserX, UserCheck } from "lucide-react";
import type { EmployeeFormData } from "../types/employee.types";
import { CONTRACT_TYPES } from "../types/employee.types";
import { usePermissions } from "@/hooks/usePermissions";
import type { FormFieldErrors } from "../hooks/useEmployeeForm";

interface EmployeeContractTabProps {
  formData: EmployeeFormData;
  isSuspended: boolean;
  hasChanges: boolean;
  isSaving: boolean;
  isSuspending: boolean;
  isReactivating: boolean;
  onUpdateField: (field: keyof EmployeeFormData, value: string | number | null) => void;
  onSave: () => void;
  onSuspendClick: () => void;
  onReactivateClick: () => void;
  // Validation errors
  fieldErrors?: FormFieldErrors;
  onClearFieldError?: (field: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: Pure calculation functions (SSOT from engine logic)
// ─────────────────────────────────────────────────────────────────────────────

/** Weeks per month (French labor law: 52/12) */
const WEEKS_PER_MONTH = 52 / 12;

/**
 * Calcul SSOT espèces : total_salary - net_salary
 * Retourne 0 si incohérent (total < net)
 */
function computeCashDisplay(totalSalary: number | null, netSalary: number | null): number {
  if (totalSalary == null || netSalary == null) return 0;
  return Math.max(0, totalSalary - netSalary);
}

/**
 * Calcul charges : brut - net
 */
function computeChargesDisplay(grossSalary: number | null, netSalary: number | null): number {
  if (grossSalary == null || netSalary == null) return 0;
  return Math.max(0, grossSalary - netSalary);
}

/**
 * Calcul heures de base mensuelles
 */
function computeMonthlyHours(contractHours: number | null): number {
  if (contractHours == null || contractHours <= 0) return 0;
  return contractHours * WEEKS_PER_MONTH;
}

/**
 * Calcul taux horaire opérationnel : total / heures mensuelles
 */
function computeHourlyRateDisplay(totalSalary: number | null, monthlyHours: number): number {
  if (totalSalary == null || monthlyHours <= 0) return 0;
  return totalSalary / monthlyHours;
}

/**
 * Calcul taux horaire avec charges : (brut + espèces) / heures mensuelles
 * Utilisé uniquement pour le prévisionnel
 */
function computeHourlyRateWithCashDisplay(
  grossSalary: number | null,
  cashAmount: number,
  monthlyHours: number
): number {
  if (grossSalary == null || monthlyHours <= 0) return 0;
  return (grossSalary + cashAmount) / monthlyHours;
}

export function EmployeeContractTab({
  formData,
  isSuspended,
  hasChanges,
  isSaving,
  isSuspending: _isSuspending,
  isReactivating,
  onUpdateField,
  onSave,
  onSuspendClick,
  onReactivateClick,
  fieldErrors = {},
  onClearFieldError,
}: EmployeeContractTabProps) {
  const { can } = usePermissions();
  const canWriteSalaries = can("salaries", "write");

  // Computed values (read-only displays)
  const cashAmountComputed = computeCashDisplay(formData.total_salary, formData.net_salary);
  const chargesComputed = computeChargesDisplay(formData.gross_salary, formData.net_salary);
  const monthlyHours = computeMonthlyHours(formData.contract_hours);
  const hourlyRateOperational = computeHourlyRateDisplay(formData.total_salary, monthlyHours);
  const hourlyRateWithCash = computeHourlyRateWithCashDisplay(
    formData.gross_salary,
    cashAmountComputed,
    monthlyHours
  );

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Informations du contrat</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Type de contrat</Label>
            {!canWriteSalaries ? (
              <p className="text-sm font-medium">
                {CONTRACT_TYPES.find((t) => t.value === formData.contract_type)?.label ||
                  "Non renseigné"}
              </p>
            ) : (
              <Select
                value={formData.contract_type || ""}
                onValueChange={(v) => onUpdateField("contract_type", v || null)}
              >
                <SelectTrigger aria-label="Type de contrat">
                  <SelectValue placeholder="Sélectionner..." />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="contract_start_date">Date de début</Label>
            {!canWriteSalaries ? (
              <p className="text-sm font-medium">
                {formData.contract_start_date
                  ? new Date(formData.contract_start_date).toLocaleDateString("fr-FR")
                  : "Non renseigné"}
              </p>
            ) : (
              <Input
                id="contract_start_date"
                type="date"
                value={formData.contract_start_date || ""}
                onChange={(e) => onUpdateField("contract_start_date", e.target.value || null)}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="contract_hours">Heures contractuelles</Label>
            {!canWriteSalaries ? (
              <p className="text-sm font-medium">
                {formData.contract_hours != null ? `${formData.contract_hours}h` : "Non renseigné"}
              </p>
            ) : (
              <Input
                id="contract_hours"
                type="number"
                step="0.5"
                value={formData.contract_hours ?? ""}
                onChange={(e) => {
                  onUpdateField(
                    "contract_hours",
                    e.target.value ? parseFloat(e.target.value) : null
                  );
                  onClearFieldError?.("contract_hours");
                }}
                placeholder="35"
                className={fieldErrors.contract_hours ? "border-destructive" : ""}
              />
            )}
            {fieldErrors.contract_hours && (
              <p className="text-sm text-destructive mt-1">{fieldErrors.contract_hours}</p>
            )}
          </div>
          <div />
          {/* Salary fields: visible and editable only with salaries:write */}
          {canWriteSalaries && (
            <>
              <div className="space-y-2">
                <Label htmlFor="gross_salary">Salaire brut (€)</Label>
                <Input
                  id="gross_salary"
                  type="number"
                  step="0.01"
                  value={formData.gross_salary ?? ""}
                  onChange={(e) => {
                    onUpdateField(
                      "gross_salary",
                      e.target.value ? parseFloat(e.target.value) : null
                    );
                    onClearFieldError?.("gross_salary");
                  }}
                  placeholder="2500.00"
                  className={fieldErrors.gross_salary ? "border-destructive" : ""}
                />
                {fieldErrors.gross_salary && (
                  <p className="text-sm text-destructive mt-1">{fieldErrors.gross_salary}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="net_salary">Salaire net (€)</Label>
                <Input
                  id="net_salary"
                  type="number"
                  step="0.01"
                  value={formData.net_salary ?? ""}
                  onChange={(e) => {
                    onUpdateField("net_salary", e.target.value ? parseFloat(e.target.value) : null);
                    onClearFieldError?.("net_salary");
                  }}
                  placeholder="1950.00"
                  className={fieldErrors.net_salary ? "border-destructive" : ""}
                />
                {fieldErrors.net_salary && (
                  <p className="text-sm text-destructive mt-1">{fieldErrors.net_salary}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="total_salary">Salaire total (€)</Label>
                <Input
                  id="total_salary"
                  type="number"
                  step="0.01"
                  value={formData.total_salary ?? ""}
                  onChange={(e) => {
                    onUpdateField(
                      "total_salary",
                      e.target.value ? parseFloat(e.target.value) : null
                    );
                    onClearFieldError?.("total_salary");
                  }}
                  placeholder="2100.00"
                  className={fieldErrors.total_salary ? "border-destructive" : ""}
                />
                {fieldErrors.total_salary && (
                  <p className="text-sm text-destructive mt-1">{fieldErrors.total_salary}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cash_amount">Espèces (€)</Label>
                <Input
                  id="cash_amount"
                  type="number"
                  step="0.01"
                  value={cashAmountComputed.toFixed(2)}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">Calculé : Total - Net</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="charges">Charges (€)</Label>
                <Input
                  id="charges"
                  type="number"
                  step="0.01"
                  value={chargesComputed.toFixed(2)}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">Calculé : Brut - Net</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="hourly_rate_operational">Taux horaire opérationnel (€/h)</Label>
                <Input
                  id="hourly_rate_operational"
                  type="number"
                  step="0.01"
                  value={hourlyRateOperational.toFixed(2)}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  Total / Heures base ({monthlyHours.toFixed(1)}h)
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="hourly_rate_with_cash">Taux horaire avec charges (€/h)</Label>
                <Input
                  id="hourly_rate_with_cash"
                  type="number"
                  step="0.01"
                  value={hourlyRateWithCash.toFixed(2)}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">(Brut + Espèces) / Heures base</p>
              </div>
            </>
          )}
        </div>

        {/* CP Transitoire Section: visible and editable only with salaries:write */}
        {canWriteSalaries && (
          <div className="pt-4 border-t">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              Congés payés (transitoire)
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cp_n1">CP N-1 (reliquat)</Label>
                <Input
                  id="cp_n1"
                  type="number"
                  step="0.5"
                  value={formData.cp_n1 ?? ""}
                  onChange={(e) =>
                    onUpdateField("cp_n1", e.target.value ? parseFloat(e.target.value) : null)
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cp_n">CP N (année en cours)</Label>
                <Input
                  id="cp_n"
                  type="number"
                  step="0.5"
                  value={formData.cp_n ?? ""}
                  onChange={(e) =>
                    onUpdateField("cp_n", e.target.value ? parseFloat(e.target.value) : null)
                  }
                  placeholder="25"
                />
              </div>
            </div>
          </div>
        )}

        {/* End date (always show if exists, not just when suspended) */}
        {formData.contract_end_date && (
          <div className="p-4 bg-muted rounded-lg">
            <Label className="text-muted-foreground">Date de fin de contrat</Label>
            <p className="text-sm font-medium">
              {new Date(formData.contract_end_date).toLocaleDateString("fr-FR")}
            </p>
          </div>
        )}
      </div>

      {/* Save + actions: visible only with salaries:write */}
      {canWriteSalaries && (
        <div className="pt-4 space-y-3">
          <Button onClick={onSave} disabled={isSaving || !hasChanges} className="w-full">
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Enregistrer
          </Button>

          {isSuspended ? (
            <Button
              variant="outline"
              onClick={onReactivateClick}
              disabled={isReactivating}
              className="w-full"
            >
              {isReactivating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserCheck className="mr-2 h-4 w-4" />
              )}
              Réintégrer le salarié
            </Button>
          ) : (
            <Button variant="destructive" onClick={onSuspendClick} className="w-full">
              <UserX className="mr-2 h-4 w-4" />
              Fin de contrat
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
