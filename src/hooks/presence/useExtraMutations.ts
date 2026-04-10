/**
 * Hook for admin extra validation mutations (approve/reject)
 * V3.3: Source of truth = extra_events.status
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ValidateExtraParams {
  extraEventId: string;
  action: "approve" | "reject";
}

function getErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "NOT_ADMIN":
      return "Action réservée aux administrateurs";
    case "OUT_OF_SCOPE":
      return "Accès non autorisé";
    case "EXTRA_NOT_FOUND":
      return "Extra introuvable";
    case "ALREADY_PROCESSED":
      return "Cet extra a déjà été traité";
    default:
      return fallback;
  }
}

export function useExtraMutations() {
  const queryClient = useQueryClient();

  const validateExtra = useMutation({
    mutationFn: async ({ extraEventId, action }: ValidateExtraParams) => {
      const { data, error } = await supabase.functions.invoke("extra-validation", {
        method: "POST",
        body: {
          extra_event_id: extraEventId,
          action,
        },
      });

      if (error) {
        if (error.message?.includes("CORS") || error.message?.includes("Failed to fetch")) {
          throw new Error("Connexion au serveur impossible");
        }
        throw new Error(error.message || "Validation impossible");
      }

      if (data && data.error) {
        throw new Error(getErrorMessage(data.code, data.error));
      }

      return data;
    },
    onSuccess: (_data, variables) => {
      const msg = variables.action === "approve" ? "Extra approuvé" : "Extra rejeté";
      toast.success(msg);
      // V3.5: Invalidate all related queries to ensure UI consistency
      // - extras: refresh extra list/detail
      // - presence: refresh presence page (effective_at changed)
      // - badge_events: refresh badgeuse display
      queryClient.invalidateQueries({ queryKey: ["extras"] });
      queryClient.invalidateQueries({ queryKey: ["presence"] });
      queryClient.invalidateQueries({ queryKey: ["badge-status"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Validation impossible");
    },
  });

  return {
    validateExtra,
    isValidating: validateExtra.isPending,
  };
}
