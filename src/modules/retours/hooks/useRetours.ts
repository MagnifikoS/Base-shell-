/**
 * useRetours — React Query hooks for the Retours module
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  getReturnsForEstablishment,
  getReturnsForCommande,
  createReturn,
  resolveReturn,
  uploadReturnPhoto,
  getReturnPhotos,
} from "../services/retourService";
import type { ReturnType, ReturnResolution } from "../types";

const QK = "product-returns";

export function useReturns(options?: { enabled?: boolean }) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const externalEnabled = options?.enabled ?? true;

  return useQuery({
    queryKey: [QK, estId],
    queryFn: () => getReturnsForEstablishment(estId!),
    enabled: !!estId && externalEnabled,
    staleTime: 60_000,
  });
}

export function useReturnsForCommande(commandeId: string | null) {
  return useQuery({
    queryKey: [QK, "commande", commandeId],
    queryFn: () => getReturnsForCommande(commandeId!),
    enabled: !!commandeId,
    staleTime: 30_000,
  });
}

export function useCreateReturn() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: (params: {
      commandeId: string;
      commandeLineId: string | null;
      productId: string;
      productNameSnapshot: string;
      quantity: number;
      canonicalUnitId: string | null;
      unitLabelSnapshot: string | null;
      returnType: ReturnType;
      reasonComment: string | null;
      clientEstablishmentId: string;
      supplierEstablishmentId: string;
    }) =>
      createReturn({
        ...params,
        createdBy: user!.id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
    },
  });
}

export function useResolveReturn() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: (params: {
      returnId: string;
      status: "accepted" | "refused";
      resolution: ReturnResolution | null;
      supplierComment: string | null;
    }) =>
      resolveReturn(
        params.returnId,
        params.status,
        params.resolution,
        params.supplierComment,
        user!.id
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
    },
  });
}

export function useUploadReturnPhoto() {
  return useMutation({
    mutationFn: (params: { returnId: string; file: File }) =>
      uploadReturnPhoto(params.returnId, params.file),
  });
}

export function useReturnPhotos(returnId: string | null) {
  return useQuery({
    queryKey: [QK, "photos", returnId],
    queryFn: () => getReturnPhotos(returnId!),
    enabled: !!returnId,
  });
}
