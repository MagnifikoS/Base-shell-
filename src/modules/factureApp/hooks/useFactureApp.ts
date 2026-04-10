/**
 * useFactureApp — React Query hooks for Facture App module
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  getAppInvoices,
  getAppInvoiceWithLines,
  getInvoiceForCommande,
  generateAppInvoice,
} from "../services/factureAppService";

const QUERY_KEY = "app-invoices";

export function useAppInvoices() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery({
    queryKey: [QUERY_KEY, estId],
    queryFn: () => getAppInvoices(estId!),
    enabled: !!estId,
    staleTime: 60_000,
  });
}

export function useAppInvoiceDetail(invoiceId: string | null) {
  return useQuery({
    queryKey: [QUERY_KEY, "detail", invoiceId],
    queryFn: () => getAppInvoiceWithLines(invoiceId!),
    enabled: !!invoiceId,
    staleTime: 60_000,
  });
}

export function useInvoiceForCommande(commandeId: string | null) {
  return useQuery({
    queryKey: [QUERY_KEY, "for-commande", commandeId],
    queryFn: () => getInvoiceForCommande(commandeId!),
    enabled: !!commandeId,
    staleTime: 30_000,
  });
}

export function useGenerateAppInvoice() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: (commandeId: string) =>
      generateAppInvoice(commandeId, user!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["commandes"] });
      queryClient.invalidateQueries({ queryKey: ["unified-commandes-products"] });
    },
  });
}
