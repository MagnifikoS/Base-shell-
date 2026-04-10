import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, UserCheck } from "lucide-react";

interface ReactivateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: (mode: "mistake" | "rehire", rehireDate?: string) => void;
}

export function ReactivateDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: ReactivateDialogProps) {
  const [mode, setMode] = useState<"mistake" | "rehire">("mistake");
  const [rehireDate, setRehireDate] = useState("");

  const handleConfirm = () => {
    if (mode === "rehire" && !rehireDate) return;
    onConfirm(mode, mode === "rehire" ? rehireDate : undefined);
  };

  const isValid = mode === "mistake" || (mode === "rehire" && rehireDate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Réintégrer le salarié</DialogTitle>
          <DialogDescription>
            Choisissez le motif de réintégration
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as "mistake" | "rehire")}
            className="space-y-3"
          >
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="mistake" id="mistake" />
              <div className="space-y-1">
                <Label htmlFor="mistake" className="cursor-pointer font-medium">
                  Archivé par erreur
                </Label>
                <p className="text-sm text-muted-foreground">
                  Le salarié n'aurait pas dû être suspendu. Restaurer son statut actif.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <RadioGroupItem value="rehire" id="rehire" />
              <div className="space-y-1">
                <Label htmlFor="rehire" className="cursor-pointer font-medium">
                  Réembauché
                </Label>
                <p className="text-sm text-muted-foreground">
                  Le salarié revient avec un nouveau contrat.
                </p>
              </div>
            </div>
          </RadioGroup>

          {mode === "rehire" && (
            <div className="space-y-2 pl-6">
              <Label htmlFor="rehire_date">Date de début du nouveau contrat *</Label>
              <Input
                id="rehire_date"
                type="date"
                value={rehireDate}
                onChange={(e) => setRehireDate(e.target.value)}
                required
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Annuler
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !isValid}>
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserCheck className="mr-2 h-4 w-4" />
            )}
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
