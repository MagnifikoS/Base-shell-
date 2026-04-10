/**
 * Hook: fetch partnerships for current establishment
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { getMyPartnerships, type B2BPartnership } from "../services/b2bPartnershipService";

export function useMyPartnerships() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  const query = useQuery<B2BPartnership[]>({
    queryKey: ["b2b-partnerships", estId],
    queryFn: () => getMyPartnerships(estId!),
    enabled: !!estId,
  });

  return {
    partnerships: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
