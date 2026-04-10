/**
 * useCommandes — React Query hooks for listing and mutating commandes
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  getCommandes,
  getCommandeWithLines,
  getActiveDraft,
  createDraftCommande,
  upsertCommandeLines,
  removeCommandeLine,
  updateCommandeNote,
  sendCommande,
  openCommande,
  shipCommande,
  receiveCommande,
  updateLinePreparation,
  deleteDraftCommande,
  getPartnerSuppliers,
  getProductsForSupplier,
  cancelShipment,
} from "../services/commandeService";
import type { CartItem } from "../types";
import { useAuth } from "@/contexts/AuthContext";

const QUERY_KEY = "commandes";
const UNIFIED_KEY = "unified-commandes-products";

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
  queryClient.invalidateQueries({ queryKey: [UNIFIED_KEY] });
}

export function useCommandes() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery({
    queryKey: [QUERY_KEY, estId],
    queryFn: () => getCommandes(estId!),
    enabled: !!estId,
    staleTime: 60_000,
  });
}

export function useActiveDraft() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery({
    queryKey: [QUERY_KEY, "active-draft", estId],
    queryFn: () => getActiveDraft(estId!),
    enabled: !!estId,
    staleTime: 30_000,
  });
}

export function useCommandeDetail(commandeId: string | null) {
  return useQuery({
    queryKey: [QUERY_KEY, "detail", commandeId],
    queryFn: () => getCommandeWithLines(commandeId!),
    enabled: !!commandeId,
    staleTime: 60_000,
  });
}

export function usePartnerSuppliers() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["partner-suppliers", estId],
    queryFn: () => getPartnerSuppliers(estId!),
    enabled: !!estId,
    staleTime: 60_000,
  });
}

export function useSupplierProducts(supplierEstablishmentId: string | null) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["supplier-products", estId, supplierEstablishmentId],
    queryFn: () => getProductsForSupplier(estId!, supplierEstablishmentId!),
    enabled: !!estId && !!supplierEstablishmentId,
    staleTime: 60_000,
  });
}

export function useCreateDraftCommande() {
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();

  return useMutation({
    mutationFn: (params: {
      supplierEstablishmentId: string;
      partnershipId: string;
      note?: string;
      sourceCommandeId?: string;
    }) =>
      createDraftCommande({
        clientEstablishmentId: activeEstablishment!.id,
        supplierEstablishmentId: params.supplierEstablishmentId,
        partnershipId: params.partnershipId,
        createdBy: user!.id,
        note: params.note,
        sourceCommandeId: params.sourceCommandeId,
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useUpsertCommandeLines() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { commandeId: string; items: CartItem[] }) =>
      upsertCommandeLines(params.commandeId, params.items),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useRemoveCommandeLine() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeCommandeLine,
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useUpdateCommandeNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { commandeId: string; note: string }) =>
      updateCommandeNote(params.commandeId, params.note),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useSendCommande() {
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();

  return useMutation({
    mutationFn: (commandeId: string) =>
      sendCommande(commandeId, activeEstablishment!.id),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useOpenCommande() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: openCommande,
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useShipCommande() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      commandeId: string;
      lines: Array<{ line_id: string; shipped_quantity: number }>;
    }) => shipCommande(params.commandeId, params.lines),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useReceiveCommande() {
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();

  return useMutation({
    mutationFn: (params: {
      commandeId: string;
      lines: Array<{ line_id: string; received_quantity: number }>;
    }) => receiveCommande(params.commandeId, activeEstablishment!.id, params.lines),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useUpdateLinePreparation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { lineId: string; shippedQuantity: number; lineStatus: string }) =>
      updateLinePreparation(params.lineId, params.shippedQuantity, params.lineStatus),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export type { LinePreparationResult } from "../services/commandeService";

export function useDeleteDraftCommande() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteDraftCommande,
    onSuccess: () => {
      invalidateAll(queryClient);
    },
  });
}

export function useCancelShipment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelShipment,
    onSuccess: () => invalidateAll(queryClient),
  });
}
