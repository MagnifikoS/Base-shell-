import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Fingerprint } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanningShift } from "../../types/planning.types";

interface TimeOption {
  value: string;
  label: string;
}

export interface ShiftEditState {
  startTime: string;
  endTime: string;
  endOptions: TimeOption[];
}

interface ShiftCoreShiftListProps {
  shifts: PlanningShift[];
  /** Map of shiftId → current edit state (all shifts always editable) */
  editStates: Record<string, ShiftEditState>;
  startOptions: TimeOption[];
  isLeaveMode: boolean;
  isLoading: boolean;
  onDeleteShift: (shiftId: string) => void;
  onEditStartChange: (shiftId: string, value: string) => void;
  onEditEndChange: (shiftId: string, value: string) => void;
  // Optional: Badge shift callback for admin quick-badge feature
  onBadgeShift?: (shift: PlanningShift) => void;
  isBadging?: boolean;
  /** Hide per-shift delete buttons (when single shift, delete is in footer) */
  hideDeleteButtons?: boolean;
  // Legacy props (kept for backward compat but unused in new inline-edit flow)
  editingShiftId?: string | null;
  editStartTime?: string;
  editEndTime?: string;
  editEndOptions?: TimeOption[];
  onStartEdit?: (shift: PlanningShift) => void;
  onCancelEdit?: () => void;
  onSaveEdit?: () => void;
}

/**
 * List of existing shifts — all shifts are directly editable (inline).
 * No click-to-edit pattern; fields are always visible.
 */
export function ShiftCoreShiftList({
  shifts,
  editStates,
  startOptions,
  isLeaveMode,
  isLoading,
  onDeleteShift,
  onEditStartChange,
  onEditEndChange,
  onBadgeShift,
  isBadging = false,
  hideDeleteButtons = false,
}: ShiftCoreShiftListProps) {
  const getDisplayLabel = (value: string, options: TimeOption[]): string => {
    const opt = options.find((o) => o.value === value);
    return opt?.label ?? "--:--";
  };

  const sortedShifts = [...shifts].sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <>
      {sortedShifts.map((shift, index) => {
        const editState = editStates[shift.id];
        if (!editState) return null;

        return (
          <div
            key={shift.id}
            className={cn(
              "border rounded-md p-3 space-y-3 transition-colors",
              isLeaveMode && "opacity-40 pointer-events-none bg-muted/30",
              !isLeaveMode && "border-primary/50 bg-primary/5"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Shift #{index + 1}</span>
              <div className="flex items-center gap-1">
                {onBadgeShift && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onBadgeShift(shift);
                    }}
                    disabled={isLoading || isLeaveMode || isBadging}
                    className="text-primary hover:text-primary"
                    title="Pré-remplir le badge avec les horaires du shift"
                  >
                    <Fingerprint className="h-4 w-4" />
                  </Button>
                )}
                {!hideDeleteButtons && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteShift(shift.id);
                    }}
                    disabled={isLoading || isLeaveMode}
                    className="text-destructive hover:text-destructive"
                    aria-label="Supprimer le shift"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Début</Label>
                <Select
                  value={editState.startTime}
                  onValueChange={(v) => onEditStartChange(shift.id, v)}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {getDisplayLabel(editState.startTime, startOptions)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {startOptions.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fin</Label>
                <Select
                  value={editState.endTime}
                  onValueChange={(v) => onEditEndChange(shift.id, v)}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {getDisplayLabel(editState.endTime, editState.endOptions)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {editState.endOptions.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
