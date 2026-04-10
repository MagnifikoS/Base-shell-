/**
 * Module Alertes Prix V0 — Hooks React Query
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPriceAlerts,
  markAlertSeen,
  markAllAlertsSeen,
  markAlertAcked,
  fetchUnackedAlertForProduct,
  fetchAlertSettings,
  upsertAlertSettings,
} from "../services/priceAlertService";
import type { PriceAlertSettings } from "../types";

const ALERTS_KEY = "price-alerts";
const SETTINGS_KEY = "price-alert-settings";

export function usePriceAlerts(establishmentId: string | undefined) {
  return useQuery({
    queryKey: [ALERTS_KEY, establishmentId],
    queryFn: () => fetchPriceAlerts(establishmentId!),
    enabled: !!establishmentId,
    staleTime: 60_000,
  });
}

export function useMarkAlertSeen(establishmentId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAlertSeen,
    onSuccess: () => qc.invalidateQueries({ queryKey: [ALERTS_KEY, establishmentId] }),
  });
}

export function useMarkAllAlertsSeen(establishmentId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllAlertsSeen(establishmentId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ALERTS_KEY, establishmentId] }),
  });
}

export function usePriceAlertSettings(establishmentId: string | undefined) {
  return useQuery({
    queryKey: [SETTINGS_KEY, establishmentId],
    queryFn: () => fetchAlertSettings(establishmentId!),
    enabled: !!establishmentId,
    staleTime: 60_000,
  });
}

export function useUpsertAlertSettings(establishmentId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Omit<Parameters<typeof upsertAlertSettings>[0], "establishment_id">) =>
      upsertAlertSettings({ ...settings, establishment_id: establishmentId! }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [SETTINGS_KEY, establishmentId] }),
  });
}

/** Convenience: is the price alerts module enabled for this establishment? */
export function usePriceAlertsEnabled(establishmentId: string | undefined) {
  const { data } = usePriceAlertSettings(establishmentId);
  return data?.enabled ?? false;
}

/** Mark an alert as acked (shown in commande popup). */
export function useMarkAlertAcked(establishmentId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAlertAcked,
    onSuccess: () => qc.invalidateQueries({ queryKey: [ALERTS_KEY, establishmentId] }),
  });
}

/** Fetch the most recent unacked alert for a given product. */
export function useFetchUnackedAlert() {
  return { fetchUnackedAlertForProduct };
}
