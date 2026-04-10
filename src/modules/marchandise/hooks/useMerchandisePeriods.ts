/**
 * Hook — Merchandise Periods List
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { computeMerchandisePeriods } from "../engine/monthlyMerchandiseEngine";
import { useUnitConversions } from "@/core/unitConversion";

export function useMerchandisePeriods() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();

  return useQuery({
    queryKey: ["merchandise-periods", estId],
    queryFn: () => computeMerchandisePeriods(estId!, dbUnits, dbConversions),
    enabled: !!estId && dbUnits.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
