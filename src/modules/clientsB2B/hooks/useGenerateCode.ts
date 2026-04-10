/**
 * Hook: generate invitation code (supplier side)
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { createInvitationCode } from "../services/b2bPartnershipService";
import { toast } from "sonner";

export function useGenerateCode() {
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!activeEstablishment?.id || !user?.id) {
        throw new Error("Établissement ou utilisateur manquant");
      }
      return createInvitationCode(activeEstablishment.id, user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["b2b-invitation-codes", activeEstablishment?.id],
      });
      toast.success("Code d'invitation généré");
    },
    onError: (err: Error) => {
      toast.error(`Erreur : ${err.message}`);
    },
  });
}
