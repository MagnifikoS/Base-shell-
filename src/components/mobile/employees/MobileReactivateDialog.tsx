/**
 * Mobile reactivation dialog for archived employees
 * Reuses EXACT same mutation logic as desktop (employees edge, action: reactivate)
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { toast } from "sonner";

interface MobileReactivateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userFullName?: string;
  establishmentId: string | null;
}

type ReactivateMode = "mistake" | "rehire";

export function MobileReactivateDialog({
  isOpen,
  onClose,
  userId,
  userFullName,
  establishmentId,
}: MobileReactivateDialogProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ReactivateMode>("mistake");
  const [rehireDate, setRehireDate] = useState("");

  // Reset state on close
  const handleClose = () => {
    setMode("mistake");
    setRehireDate("");
    onClose();
  };

  // EXACT same mutation as desktop useEmployeeMutations.reactivateMutation
  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const response = await supabase.functions.invoke("employees", {
        body: {
          action: "reactivate",
          user_id: userId,
          reactivate_mode: mode,
          rehire_start_date: mode === "rehire" ? rehireDate : undefined,
        },
      });

      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate ALL relevant queries (mobile + desktop) for source of truth sync
      // Desktop keys
      queryClient.invalidateQueries({ queryKey: ["employee", userId] });
      queryClient.invalidateQueries({ queryKey: ["employees", establishmentId] });
      queryClient.invalidateQueries({ queryKey: ["archived-employees", establishmentId] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"], exact: false });
      // P-PLANNING-2: Scopé à l'établissement pour éviter refetch cross-establishments
      if (establishmentId) {
        queryClient.invalidateQueries({ queryKey: ["planning-week", establishmentId], exact: false });
      }
      // Mobile keys
      queryClient.invalidateQueries({ queryKey: ["employees-mobile", establishmentId] });
      queryClient.invalidateQueries({ queryKey: ["archived-employees-mobile", establishmentId] });

      toast.success("Salarié réactivé");
      handleClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la réactivation");
    },
  });

  const handleConfirm = () => {
    if (mode === "rehire" && !rehireDate) return;
    reactivateMutation.mutate();
  };

  const isValid = mode === "mistake" || (mode === "rehire" && rehireDate);
  const isPending = reactivateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-[90vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Réintégrer le salarié</DialogTitle>
          <DialogDescription>
            {userFullName ? `Réactiver ${userFullName}` : "Choisissez le motif de réintégration"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as ReactivateMode)}
            className="space-y-3"
          >
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="mistake" id="mobile-mistake" />
              <div className="space-y-1">
                <Label htmlFor="mobile-mistake" className="cursor-pointer font-medium">
                  Archivé par erreur
                </Label>
                <p className="text-sm text-muted-foreground">
                  Le salarié n'aurait pas dû être suspendu. Restaurer son statut actif.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <RadioGroupItem value="rehire" id="mobile-rehire" />
              <div className="space-y-1">
                <Label htmlFor="mobile-rehire" className="cursor-pointer font-medium">
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
              <Label htmlFor="mobile_rehire_date">Date de début du nouveau contrat *</Label>
              <Input
                id="mobile_rehire_date"
                type="date"
                value={rehireDate}
                onChange={(e) => setRehireDate(e.target.value)}
                required
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isPending}
            className="flex-1"
          >
            Annuler
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending || !isValid}
            className="flex-1"
          >
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
