/**
 * Form component for editing a single cash day report
 */

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import {
  Loader2,
  Save,
  CreditCard,
  Banknote,
  Truck,
  ShoppingCart,
  Wrench,
  AlertTriangle,
} from "lucide-react";
import { calculateCA, calculateBalance, formatEur, parseEurInput } from "../utils/money";
import { formatBusinessDay } from "../utils/businessDay";
import { cashDaySchema } from "@/lib/schemas/settings";
import type { ZodError } from "zod";
import type { CashDayFormValues, CashDayReport } from "../utils/types";
import { DEFAULT_FORM_VALUES } from "../utils/types";

interface CashDayFormProps {
  dayDate: string;
  initialData: CashDayReport | null;
  onSave: (values: CashDayFormValues) => void;
  isSaving: boolean;
  canWrite: boolean;
}

interface FieldConfig {
  key: keyof CashDayFormValues;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isNegative?: boolean;
}

const FIELDS: FieldConfig[] = [
  { key: "cb_eur", label: "CB", icon: CreditCard },
  { key: "cash_eur", label: "Espèces", icon: Banknote },
  { key: "delivery_eur", label: "Livraison", icon: Truck },
  { key: "courses_eur", label: "Courses", icon: ShoppingCart, isNegative: true },
  { key: "maintenance_eur", label: "Maintenance", icon: Wrench, isNegative: true },
  { key: "shortage_eur", label: "Manque", icon: AlertTriangle, isNegative: true },
];

export function CashDayForm({
  dayDate,
  initialData,
  onSave,
  isSaving,
  canWrite,
}: CashDayFormProps) {
  const [values, setValues] = useState<CashDayFormValues>(DEFAULT_FORM_VALUES);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Reset form when initial data changes
  useEffect(() => {
    if (initialData) {
      setValues({
        cb_eur: initialData.cb_eur ?? 0,
        cash_eur: initialData.cash_eur ?? 0,
        delivery_eur: initialData.delivery_eur ?? 0,
        courses_eur: initialData.courses_eur ?? 0,
        maintenance_eur: initialData.maintenance_eur ?? 0,
        shortage_eur: initialData.shortage_eur ?? 0,
        advance_eur: initialData.advance_eur ?? 0,
        advance_employee_id: initialData.advance_employee_id ?? null,
        note: initialData.note ?? "",
      });
    } else {
      setValues(DEFAULT_FORM_VALUES);
    }
  }, [initialData]);

  const ca = useMemo(() => calculateCA(values), [values]);
  const balance = useMemo(() => calculateBalance(values), [values]);

  const handleFieldChange = (key: keyof CashDayFormValues, value: string) => {
    if (key === "note") {
      setValues((prev) => ({ ...prev, note: value }));
    } else {
      setValues((prev) => ({ ...prev, [key]: parseEurInput(value) }));
    }
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    const result = cashDaySchema.safeParse(values);
    if (!result.success) {
      const errors: Record<string, string> = {};
      (result.error as ZodError).issues.forEach((issue) => {
        const field = issue.path.join(".");
        if (!errors[field]) errors[field] = issue.message;
      });
      setFieldErrors(errors);
      return;
    }

    onSave(values);
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-medium">{formatBusinessDay(dayDate)}</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {FIELDS.map(({ key, label, icon: Icon, isNegative }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key} className="flex items-center gap-2 text-sm">
                  <Icon
                    className={`h-4 w-4 ${isNegative ? "text-destructive" : "text-muted-foreground"}`}
                  />
                  {label}
                  {isNegative && <span className="text-destructive text-xs">(−)</span>}
                </Label>
                <Input
                  id={key}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={values[key] || ""}
                  onChange={(e) => handleFieldChange(key, e.target.value)}
                  disabled={!canWrite}
                  placeholder="0.00"
                  className={`text-right ${fieldErrors[key] ? "border-destructive" : ""}`}
                />
                {fieldErrors[key] && <p className="text-sm text-destructive">{fieldErrors[key]}</p>}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Note (optionnel)</Label>
            <Textarea
              id="note"
              value={values.note}
              onChange={(e) => handleFieldChange("note", e.target.value)}
              disabled={!canWrite}
              placeholder="Remarques..."
              rows={2}
              className={fieldErrors.note ? "border-destructive" : ""}
            />
            {fieldErrors.note && <p className="text-sm text-destructive">{fieldErrors.note}</p>}
          </div>

          {/* CA and Balance display */}
          <div className="pt-4 border-t space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold">Chiffre d'Affaires</span>
              <span className="text-2xl font-bold text-primary">{formatEur(ca)}</span>
            </div>
            <p className="text-xs text-muted-foreground">CB + Espèces + Livraison</p>

            <div className="flex justify-between items-center pt-2 border-t border-dashed">
              <span className="text-sm font-medium text-muted-foreground">Solde net</span>
              <span
                className={`text-lg font-semibold ${balance >= 0 ? "text-foreground" : "text-destructive"}`}
              >
                {formatEur(balance)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">CA − Courses − Maintenance − Manque</p>
          </div>
        </CardContent>

        {canWrite && (
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Enregistrer
                </>
              )}
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}
