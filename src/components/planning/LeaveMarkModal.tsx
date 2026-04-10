import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

interface LeaveMarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeName: string;
  date: string;
  onConfirm: (leaveType: "cp" | "absence", reason?: string) => void;
  isLoading?: boolean;
}

export function LeaveMarkModal({
  isOpen,
  onClose,
  employeeName,
  date,
  onConfirm,
  isLoading = false,
}: LeaveMarkModalProps) {
  const [leaveType, setLeaveType] = useState<"cp" | "absence">("absence");
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    onConfirm(leaveType, reason.trim() || undefined);
  };

  const handleClose = () => {
    setLeaveType("absence");
    setReason("");
    onClose();
  };

  const formattedDate = date
    ? format(parseISO(date), "EEEE d MMMM yyyy", { locale: fr })
    : "";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marquer CP / Absence</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">{employeeName}</p>
            <p className="text-sm text-muted-foreground capitalize">
              {formattedDate}
            </p>
          </div>

          <div className="space-y-3">
            <Label>Type</Label>
            <RadioGroup
              value={leaveType}
              onValueChange={(val) => setLeaveType(val as "cp" | "absence")}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="absence" id="absence" />
                <Label htmlFor="absence" className="cursor-pointer">
                  Absence
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="cp" id="cp" />
                <Label htmlFor="cp" className="cursor-pointer">
                  Congé payé (CP)
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Motif (optionnel)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Rendez-vous médical, congé familial..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Annuler
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? "Enregistrement..." : "Confirmer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
