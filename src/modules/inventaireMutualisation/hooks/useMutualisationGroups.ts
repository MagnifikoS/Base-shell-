/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — Persisted Groups Hook
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CRUD operations on inventory_mutualisation_groups/members tables.
 * NEVER writes to products_v2 or any other module table.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  fetchGroups,
  createGroup,
  deactivateGroup,
  updateGroupB2b,
} from "../services/mutualisationService";

const GROUPS_KEY = "mutualisation-groups";

export function useMutualisationGroups() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [GROUPS_KEY, establishmentId],
    enabled: !!establishmentId,
    queryFn: () => fetchGroups(establishmentId!),
  });

  const createMutation = useMutation({
    mutationFn: (params: {
      displayName: string;
      carrierProductId: string;
      memberProductIds: string[];
      b2bBillingUnitId?: string | null;
      b2bUnitPrice?: number | null;
      b2bPriceStrategy?: string | null;
    }) =>
      createGroup({
        establishmentId: establishmentId!,
        displayName: params.displayName,
        carrierProductId: params.carrierProductId,
        memberProductIds: params.memberProductIds,
        userId: user?.id ?? "",
        b2bBillingUnitId: params.b2bBillingUnitId,
        b2bUnitPrice: params.b2bUnitPrice,
        b2bPriceStrategy: params.b2bPriceStrategy,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [GROUPS_KEY, establishmentId] });
      qc.invalidateQueries({
        queryKey: ["mutualisation-suggestions", establishmentId],
      });
      toast.success("Groupe de mutualisation créé");
    },
    onError: () => {
      toast.error("Erreur lors de la création du groupe");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deactivateGroup,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [GROUPS_KEY, establishmentId] });
      qc.invalidateQueries({
        queryKey: ["mutualisation-suggestions", establishmentId],
      });
      toast.success("Groupe supprimé");
    },
    onError: () => {
      toast.error("Erreur lors de la suppression du groupe");
    },
  });

  const updateB2bMutation = useMutation({
    mutationFn: (params: {
      groupId: string;
      b2bBillingUnitId: string | null;
      b2bUnitPrice: number | null;
      b2bPriceStrategy: string;
    }) =>
      updateGroupB2b(params.groupId, {
        b2bBillingUnitId: params.b2bBillingUnitId,
        b2bUnitPrice: params.b2bUnitPrice,
        b2bPriceStrategy: params.b2bPriceStrategy,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [GROUPS_KEY, establishmentId] });
      toast.success("Prix B2B mis à jour");
    },
    onError: () => {
      toast.error("Erreur lors de la mise à jour du prix B2B");
    },
  });

  return {
    groups: query.data ?? [],
    isLoading: query.isLoading,
    create: createMutation.mutate,
    isCreating: createMutation.isPending,
    remove: deleteMutation.mutate,
    isRemoving: deleteMutation.isPending,
    updateB2b: updateB2bMutation.mutate,
    isUpdatingB2b: updateB2bMutation.isPending,
  };
}
