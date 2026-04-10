/**
 * Hook — Merchandise Period Detail
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { computeMerchandisePeriodDetail } from "../engine/monthlyMerchandiseEngine";
import { useUnitConversions } from "@/core/unitConversion";

export function useMerchandisePeriodDetail(sessionAId: string | null, sessionBId: string | null) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();

  return useQuery({
    queryKey: ["merchandise-period-detail", sessionAId, sessionBId, estId],
    queryFn: () => computeMerchandisePeriodDetail(sessionAId!, sessionBId!, estId!, dbUnits, dbConversions),
    enabled: !!sessionAId && !!sessionBId && !!estId && dbUnits.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
