/**
 * Hook: redeem invitation code (client side)
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { redeemCode } from "../services/b2bPartnershipService";
import { toast } from "sonner";

const ERROR_MESSAGES: Record<string, string> = {
  CODE_NOT_FOUND: "Code introuvable",
  CODE_ALREADY_USED: "Ce code a déjà été utilisé",
  CODE_EXPIRED: "Ce code a expiré",
  SAME_ORGANIZATION: "Impossible de créer un partenariat au sein de la même organisation",
  PARTNERSHIP_EXISTS: "Un partenariat existe déjà avec ce fournisseur",
  NOT_AUTHORIZED: "Vous n'êtes pas autorisé pour cet établissement",
};

export function useRedeemCode() {
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => {
      if (!activeEstablishment?.id) {
        throw new Error("Établissement manquant");
      }
      return redeemCode(code, activeEstablishment.id);
    },
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("Partenariat créé avec succès !");
        queryClient.invalidateQueries({ queryKey: ["b2b-partnerships"] });
      } else {
        toast.error(ERROR_MESSAGES[result.error ?? ""] ?? `Erreur : ${result.error}`);
      }
    },
    onError: (err: Error) => {
      toast.error(`Erreur : ${err.message}`);
    },
  });
}
