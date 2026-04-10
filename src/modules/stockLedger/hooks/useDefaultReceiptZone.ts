/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useDefaultReceiptZone — Loads default receipt zone from establishment_stock_settings
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FALLBACK BEHAVIOR:
 * - If a default_receipt_zone_id is configured, uses it directly.
 * - If NOT configured but storage zones exist, auto-selects the first zone
 *   and exposes `needsSelection = true` so the UI can show a zone picker.
 * - If NO zones exist at all, returns `noZonesExist = true`.
 *
 * The caller can override the selected zone via `setSelectedZoneId`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useStorageZones } from "@/modules/produitsV2";

export interface DefaultReceiptZone {
  zoneId: string;
  zoneName: string;
}

export function useDefaultReceiptZone() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const { zones, isLoading: zonesLoading } = useStorageZones();

  const [userSelectedZoneId, setUserSelectedZoneId] = useState<string | null>(null);

  const { data: configuredZone, isLoading: settingsLoading } = useQuery({
    queryKey: ["default-receipt-zone", estId],
    queryFn: async (): Promise<DefaultReceiptZone | null> => {
      if (!estId) return null;

      const { data: settings, error: settErr } = await supabase
        .from("establishment_stock_settings")
        .select("default_receipt_zone_id")
        .eq("establishment_id", estId)
        .maybeSingle();

      if (settErr) throw settErr;
      if (!settings?.default_receipt_zone_id) return null;

      const { data: zone, error: zoneErr } = await supabase
        .from("storage_zones")
        .select("id, name")
        .eq("id", settings.default_receipt_zone_id)
        .single();

      if (zoneErr) throw zoneErr;
      return { zoneId: zone.id, zoneName: zone.name };
    },
    enabled: !!estId,
    staleTime: 60_000,
  });

  const isLoading = settingsLoading || zonesLoading;

  // Reset user selection when establishment changes
  useEffect(() => {
    setUserSelectedZoneId(null);
  }, [estId]);

  // Auto-select first zone when there's exactly one and no default is configured
  useEffect(() => {
    if (isLoading || configuredZone || userSelectedZoneId) return;
    if (zones.length === 1) {
      setUserSelectedZoneId(zones[0].id);
    }
  }, [isLoading, configuredZone, userSelectedZoneId, zones]);

  // Resolve the effective zone: configured > user-selected > null
  let effectiveZone: DefaultReceiptZone | null = null;
  if (configuredZone) {
    effectiveZone = configuredZone;
  } else if (userSelectedZoneId) {
    const match = zones.find((z) => z.id === userSelectedZoneId);
    if (match) {
      effectiveZone = { zoneId: match.id, zoneName: match.name };
    }
  }

  // No default configured AND zones exist => user needs to pick (unless auto-selected)
  const needsSelection = !isLoading && !configuredZone && zones.length > 1 && !userSelectedZoneId;
  // No zones at all — truly blocked
  const noZonesExist = !isLoading && zones.length === 0;

  return {
    /** The resolved zone (from settings, user selection, or auto-select) */
    defaultZone: effectiveZone,
    isLoading,
    /** True when no default is configured AND no zones exist at all */
    isMissing: noZonesExist,
    /** True when no default is configured but zones exist and user has not picked yet */
    needsSelection,
    /** Available zones for the picker UI */
    availableZones: zones,
    /** Set a zone manually (when no default is configured) */
    setSelectedZoneId: setUserSelectedZoneId,
    /** Whether zone was auto-selected or user-selected (not from settings) */
    isManualSelection: !configuredZone && !!effectiveZone,
  };
}
