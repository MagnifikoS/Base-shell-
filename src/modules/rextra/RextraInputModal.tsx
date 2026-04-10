/**
 * R-Extra Module: Modal for entering R.Extra minutes to pose
 */

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Clock } from "lucide-react";

interface RextraInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (minutes: number) => void;
  isLoading: boolean;
  employeeName: string;
  date: string;
  availableMinutes: number;
}

function formatMinutesToDisplay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

export function RextraInputModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  employeeName,
  date,
  availableMinutes,
}: RextraInputModalProps) {
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("0");

  const totalMinutes = useMemo(() => {
    const h = parseInt(hours, 10) || 0;
    const m = parseInt(minutes, 10) || 0;
    return h * 60 + m;
  }, [hours, minutes]);

  const isValid = totalMinutes > 0 && totalMinutes <= availableMinutes;
  const exceedsBalance = totalMinutes > availableMinutes;

  // Generate hour options (0 to max available hours)
  const maxHours = Math.floor(availableMinutes / 60);
  const hourOptions = useMemo(() => {
    return Array.from({ length: Math.min(maxHours + 1, 25) }, (_, i) => i);
  }, [maxHours]);

  // Minutes options: 0, 15, 30, 45
  const minuteOptions = [0, 15, 30, 45];

  const handleConfirm = () => {
    if (isValid) {
      onConfirm(totalMinutes);
    }
  };

  const handleClose = () => {
    setHours("0");
    setMinutes("0");
    onClose();
  };

  // Quick select presets
  const presets = useMemo(() => {
    const options = [60, 120, 180, 240, 300, 360, 420, 480];
    return options.filter((m) => m <= availableMinutes).slice(0, 4);
  }, [availableMinutes]);

  const handlePreset = (m: number) => {
    setHours(String(Math.floor(m / 60)));
    setMinutes(String(m % 60));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Poser R.Extra
          </DialogTitle>
          <DialogDescription>
            {employeeName} — {new Date(date).toLocaleDateString("fr-FR", { 
              weekday: "long", 
              day: "numeric", 
              month: "long" 
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Available balance */}
          <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 flex items-center gap-2">
            <span>Solde disponible:</span>
            <span className="font-semibold text-foreground">
              {formatMinutesToDisplay(availableMinutes)}
            </span>
          </div>

          {/* Select fields */}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="rextra-hours" className="text-xs text-muted-foreground">
                Heures
              </Label>
              <Select value={hours} onValueChange={setHours}>
                <SelectTrigger id="rextra-hours" className="text-center text-lg">
                  <SelectValue placeholder="0" />
                </SelectTrigger>
                <SelectContent>
                  {hourOptions.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="text-muted-foreground pb-2">:</span>
            <div className="flex-1">
              <Label htmlFor="rextra-minutes" className="text-xs text-muted-foreground">
                Minutes
              </Label>
              <Select value={minutes} onValueChange={setMinutes}>
                <SelectTrigger id="rextra-minutes" className="text-center text-lg">
                  <SelectValue placeholder="0" />
                </SelectTrigger>
                <SelectContent>
                  {minuteOptions.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Quick presets */}
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {presets.map((m) => (
                <Button
                  key={m}
                  variant="outline"
                  size="sm"
                  onClick={() => handlePreset(m)}
                  className="text-xs"
                >
                  {formatMinutesToDisplay(m)}
                </Button>
              ))}
            </div>
          )}

          {/* Error message */}
          {exceedsBalance && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>Solde insuffisant ({formatMinutesToDisplay(availableMinutes)} disponibles)</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Annuler
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!isValid || isLoading}
          >
            {isLoading ? "Validation..." : `Poser ${formatMinutesToDisplay(totalMinutes)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}