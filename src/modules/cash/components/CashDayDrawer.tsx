/**
 * CashDayDrawer — Single drawer showing day details with collapsible section + edit mode.
 * Edit mode allows full correction of all fields (CB, espèces, livraison, courses, maintenance, manque, note, acompte).
 */

import { useState, useMemo, useEffect } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Save,
  X,
  Loader2,
  CreditCard,
  Banknote,
  Truck,
  ShoppingCart,
  Wrench,
  AlertTriangle,
  UserRound,
} from "lucide-react";
import { formatBusinessDay } from "../utils/businessDay";
import { calculateCA, calculateBalance, formatEur, parseEurInput } from "../utils/money";
import { AmountCell } from "./AmountCell";
import { useCashDay } from "../hooks/useCashDay";
import type { CashDayFormValues } from "../utils/types";
import { DEFAULT_FORM_VALUES } from "../utils/types";

interface CashDayDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayDate: string;
  establishmentId: string;
  canWrite: boolean;
  visible: boolean;
  isToday: boolean;
}

export function CashDayDrawer({
  open,
  onOpenChange,
  dayDate,
  establishmentId,
  canWrite,
  visible,
  isToday,
}: CashDayDrawerProps) {
  const { report, save, isSaving } = useCashDay({
    establishmentId,
    dayDate,
  });

  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<CashDayFormValues>(DEFAULT_FORM_VALUES);

  // Reset edit mode when drawer closes or day changes
  useEffect(() => {
    if (!open) {
      setEditMode(false);
      setDetailsExpanded(false);
    }
  }, [open]);

  // Populate edit values from report
  useEffect(() => {
    if (report) {
      setEditValues({
        cb_eur: report.cb_eur ?? 0,
        cash_eur: report.cash_eur ?? 0,
        delivery_eur: report.delivery_eur ?? 0,
        courses_eur: report.courses_eur ?? 0,
        maintenance_eur: report.maintenance_eur ?? 0,
        shortage_eur: report.shortage_eur ?? 0,
        advance_eur: report.advance_eur ?? 0,
        advance_employee_id: report.advance_employee_id ?? null,
        note: report.note ?? "",
      });
    } else {
      setEditValues(DEFAULT_FORM_VALUES);
    }
  }, [report]);

  const ca = useMemo(
    () => (report ? calculateCA(report) : 0),
    [report]
  );
  const balance = useMemo(
    () => (report ? calculateBalance(report) : 0),
    [report]
  );

  const editCa = useMemo(() => calculateCA(editValues), [editValues]);
  const editBalance = useMemo(() => calculateBalance(editValues), [editValues]);

  const handleEditField = (key: keyof CashDayFormValues, value: string) => {
    if (key === "note") {
      setEditValues((prev) => ({ ...prev, note: value }));
    } else if (key === "advance_employee_id") {
      setEditValues((prev) => ({ ...prev, advance_employee_id: value || null }));
    } else {
      setEditValues((prev) => ({ ...prev, [key]: parseEurInput(value) }));
    }
  };

  const handleSave = () => {
    save(editValues, {
      onSuccess: () => setEditMode(false),
    });
  };

  const hasData = report !== null;

  // Detail rows definition
  const mainRows = [
    { label: "CB", value: report?.cb_eur ?? 0, icon: CreditCard, editKey: "cb_eur" as const },
    { label: "Espèces", value: report?.cash_eur ?? 0, icon: Banknote, editKey: "cash_eur" as const },
    { label: "Livraison", value: report?.delivery_eur ?? 0, icon: Truck, editKey: "delivery_eur" as const },
    { label: "Courses", value: report?.courses_eur ?? 0, icon: ShoppingCart, editKey: "courses_eur" as const },
  ];

  const expenseRows = [
    { label: "Maintenance", value: report?.maintenance_eur ?? 0, icon: Wrench, editKey: "maintenance_eur" as const, negative: true },
    { label: "Manque", value: report?.shortage_eur ?? 0, icon: AlertTriangle, editKey: "shortage_eur" as const, negative: true },
    { label: "Acompte", value: report?.advance_eur ?? 0, icon: UserRound, editKey: "advance_eur" as const, negative: true },
  ];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="capitalize">{formatBusinessDay(dayDate)}</DrawerTitle>
          <DrawerDescription>
            {isToday ? "Journée en cours" : hasData ? "Données enregistrées" : "Aucune donnée"}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4 overflow-y-auto space-y-4">
          {!editMode ? (
            /* ═══ Read Mode ═══ */
            <>
              {/* Summary */}
              {hasData && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-muted-foreground">CA brut</span>
                    <AmountCell value={ca} visible={visible} className="text-lg font-bold text-foreground tabular-nums" />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-muted-foreground">Solde net</span>
                    <AmountCell
                      value={balance}
                      visible={visible}
                      className={`text-lg font-bold tabular-nums ${balance >= 0 ? "text-foreground" : "text-destructive"}`}
                    />
                  </div>
                </div>
              )}

              {/* Collapsible details */}
              {hasData && (
                <div>
                  <button
                    type="button"
                    onClick={() => setDetailsExpanded((v) => !v)}
                    className="flex items-center gap-1 text-sm text-primary font-medium w-full justify-center py-2"
                  >
                    {detailsExpanded ? (
                      <>
                        Masquer les détails <ChevronUp className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        Voir les détails <ChevronDown className="h-4 w-4" />
                      </>
                    )}
                  </button>

                  {detailsExpanded && (
                    <div className="space-y-2 pt-2">
                      {/* Revenue rows */}
                      {mainRows.map(({ label, value, icon: Icon }) => (
                        <div key={label} className="flex items-center justify-between py-1">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-foreground">{label}</span>
                          </div>
                          <AmountCell value={value} visible={visible} className="text-sm tabular-nums" />
                        </div>
                      ))}

                      <div className="border-t border-dashed my-2" />

                      {/* Expense rows */}
                      {expenseRows.map(({ label, value, icon: Icon }) => (
                        <div key={label} className="flex items-center justify-between py-1">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-destructive" />
                            <span className="text-sm text-foreground">{label}</span>
                          </div>
                          <AmountCell value={value} visible={visible} className="text-sm tabular-nums text-destructive" />
                        </div>
                      ))}

                      {/* Note */}
                      {report?.note && (
                        <div className="pt-2 border-t">
                          <p className="text-xs text-muted-foreground mb-1">Note</p>
                          <p className="text-sm text-foreground">{report.note}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Action buttons */}
              {canWrite && (
                <div className="pt-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setEditMode(true)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Modifier
                  </Button>
                </div>
              )}
            </>
          ) : (
            /* ═══ Edit Mode ═══ */
            <div className="space-y-4">
              {/* All fields editable */}
              <div className="grid grid-cols-2 gap-3">
                {[...mainRows, ...expenseRows].map(({ label, icon: Icon, editKey }) => (
                  <div key={editKey} className="space-y-1">
                    <Label className="flex items-center gap-1 text-xs">
                      <Icon className="h-3 w-3" />
                      {label}
                    </Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={editValues[editKey] || ""}
                      onChange={(e) => handleEditField(editKey, e.target.value)}
                      className="text-right text-sm h-9"
                      placeholder="0.00"
                    />
                  </div>
                ))}
              </div>

              {/* Note */}
              <div className="space-y-1">
                <Label className="text-xs">Note</Label>
                <Textarea
                  value={editValues.note}
                  onChange={(e) => handleEditField("note", e.target.value)}
                  rows={2}
                  placeholder="Remarques..."
                  className="text-sm"
                />
              </div>

              {/* Edit summary */}
              <div className="border-t pt-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">CA brut</span>
                  <span className="text-sm font-bold tabular-nums">{formatEur(editCa)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Solde net</span>
                  <span className={`text-sm font-bold tabular-nums ${editBalance >= 0 ? "" : "text-destructive"}`}>
                    {formatEur(editBalance)}
                  </span>
                </div>
              </div>

              {/* Save / Cancel */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setEditMode(false)}
                  disabled={isSaving}
                >
                  <X className="mr-1 h-4 w-4" />
                  Annuler
                </Button>
                <Button className="flex-1" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-4 w-4" />
                  )}
                  Enregistrer
                </Button>
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
