/**
 * Hook: fetch invitation codes for current supplier establishment
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { getMyInvitationCodes, type B2BInvitationCode } from "../services/b2bPartnershipService";

export function useInvitationCodes() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  const query = useQuery<B2BInvitationCode[]>({
    queryKey: ["b2b-invitation-codes", estId],
    queryFn: () => getMyInvitationCodes(estId!),
    enabled: !!estId,
  });

  return {
    codes: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
