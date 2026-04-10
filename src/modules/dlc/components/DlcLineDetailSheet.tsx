/**
 * DLC V0 — Bottom sheet for viewing/editing DLC on a commande line.
 * Option B UX: tap line → detail panel with quantity + DLC + status.
 */

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarIcon, Save, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { DlcBadge, computeDlcStatus } from "./DlcBadge";
import { useDlcUpsert } from "../hooks/useDlcMutations";
import type { DlcUpsertInput } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Product display name */
  productName: string;
  /** Quantity received (read-only display) */
  quantityLabel: string;
  /** Current DLC date if already set (YYYY-MM-DD) */
  currentDlcDate: string | null;
  /** Product-level warning days */
  warningDays?: number | null;
  /** Data needed for upsert */
  upsertData: Omit<DlcUpsertInput, "dlc_date"> | null;
  /** Called after successful save */
  onSaved?: () => void;
  /** If true, this is during reception flow — uses local state callback instead of DB upsert */
  isReceptionFlow?: boolean;
  /** Callback for reception flow — returns the selected date without DB write */
  onDlcSelected?: (dlcDate: string) => void;
}

export function DlcLineDetailSheet({
  open,
  onClose,
  productName,
  quantityLabel,
  currentDlcDate,
  warningDays,
  upsertData,
  onSaved,
  isReceptionFlow,
  onDlcSelected,
}: Props) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    currentDlcDate ? new Date(currentDlcDate + "T00:00:00") : undefined
  );
  const upsertMutation = useDlcUpsert();

  // Sync when sheet opens
  useEffect(() => {
    if (open) {
      setSelectedDate(
        currentDlcDate ? new Date(currentDlcDate + "T00:00:00") : undefined
      );
    }
  }, [open, currentDlcDate]);

  const dlcDateStr = selectedDate
    ? selectedDate.toISOString().split("T")[0]
    : null;
  const status = dlcDateStr ? computeDlcStatus(dlcDateStr, warningDays) : null;

  const handleSave = useCallback(async () => {
    if (!dlcDateStr) return;

    // Reception flow: just pass date back, no DB write
    if (isReceptionFlow) {
      onDlcSelected?.(dlcDateStr);
      onClose();
      return;
    }

    // Post-reception: write to DB
    if (!upsertData) return;
    try {
      await upsertMutation.mutateAsync({
        ...upsertData,
        dlc_date: dlcDateStr,
      });
      toast.success("DLC enregistrée");
      onSaved?.();
      onClose();
    } catch {
      toast.error("Erreur lors de l'enregistrement de la DLC");
    }
  }, [dlcDateStr, isReceptionFlow, upsertData, upsertMutation, onDlcSelected, onSaved, onClose]);

  const hasChanged = dlcDateStr !== currentDlcDate;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[80vh] sm:max-h-[60vh]">
        <SheetHeader>
          <SheetTitle className="text-base truncate">{productName}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Quantity (read-only) */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Quantité reçue</span>
            <span className="font-semibold tabular-nums">{quantityLabel}</span>
          </div>

          {/* DLC DatePicker */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Date Limite de Consommation (DLC)</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {selectedDate
                    ? format(selectedDate, "dd MMMM yyyy", { locale: fr })
                    : "Sélectionner une date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* DLC Status badge */}
          {dlcDateStr && (
            <div className="flex items-center gap-2">
              <DlcBadge dlcDate={dlcDateStr} warningDays={warningDays} />
              {status === "expired" && (
                <span className="text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  DLC dépassée, vérifiez le produit
                </span>
              )}
            </div>
          )}

          {/* Save button */}
          <Button
            onClick={handleSave}
            disabled={!dlcDateStr || (!hasChanged && !isReceptionFlow) || upsertMutation.isPending}
            className="w-full"
          >
            {upsertMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Save className="h-4 w-4 mr-1.5" />
            )}
            {isReceptionFlow ? "Confirmer la DLC" : "Enregistrer la DLC"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
