/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HOOK: useWithdrawalHistory — Read-only withdrawal history for a month
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Source: stock_events WHERE event_type = 'WITHDRAWAL'
 *
 * INCLUDED:
 *   - Normal operational withdrawals (CONSUMPTION, EXPIRY)
 *   - voids_document_id IS NULL (excludes void/correction counter-events)
 *
 * EXCLUDED:
 *   - VOID events (event_type = 'VOID')
 *   - ADJUSTMENT events
 *   - Void counter-entries (voids_document_id IS NOT NULL)
 *   - RECEIPT, INITIAL_STOCK
 *
 * Unit display strategy:
 *   - Reconverts canonical quantity → withdrawal unit via BFS
 *   - Fallback: canonical quantity + canonical unit name
 *   - NEVER mixes canonical quantity with non-canonical unit label
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { reconvertToDisplayUnit } from "../utils/reconvertToDisplayUnit";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type { Json } from "@/integrations/supabase/types";

export interface WithdrawalHistoryEntry {
  id: string;
  posted_at: string;
  product_name: string;
  quantity: number; // absolute value, in display unit
  unit_name: string; // matches the quantity (always coherent)
  author_name: string;
  event_reason: string;
}

export interface WithdrawalDayGroup {
  /** ISO date string YYYY-MM-DD */
  date: string;
  entries: WithdrawalHistoryEntry[];
}

export function useWithdrawalHistory(
  establishmentId: string | null,
  yearMonth: string | null // "YYYY-MM"
) {
  return useQuery({
    queryKey: ["withdrawal-history", establishmentId, yearMonth],
    queryFn: async (): Promise<WithdrawalDayGroup[]> => {
      if (!establishmentId || !yearMonth) return [];

      // Build date range for the month
      const [yearStr, monthStr] = yearMonth.split("-");
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const startDate = `${yearMonth}-01T00:00:00`;
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00`;

      // 1. Fetch withdrawal events with product + unit data (including IDs for BFS)
      const { data, error } = await supabase
        .from("stock_events")
        .select(`
          id,
          posted_at,
          posted_by,
          product_id,
          delta_quantity_canonical,
          canonical_unit_id,
          event_reason,
          product:products_v2!stock_events_product_id_fkey (
            nom_produit,
            stock_handling_unit_id,
            conditionnement_config,
            stock_handling_unit:measurement_units!products_v2_stock_handling_unit_id_fkey ( id, name )
          ),
          canonical_unit:measurement_units!stock_events_canonical_unit_id_fkey ( id, name )
        `)
        .eq("establishment_id", establishmentId)
        .eq("event_type", "WITHDRAWAL")
        .is("voids_document_id", null)
        .gte("posted_at", startDate)
        .lt("posted_at", endDate)
        .order("posted_at", { ascending: false });

      if (error) throw error;
      if (!data || data.length === 0) return [];

      // 2. Fetch DB units + conversions for BFS reconversion
      const [unitsRes, convsRes] = await Promise.all([
        supabase
          .from("measurement_units")
          .select("id, name, abbreviation, category, family, is_reference, aliases")
          .eq("establishment_id", establishmentId)
          .eq("is_active", true),
        supabase
          .from("unit_conversions")
          .select("id, from_unit_id, to_unit_id, factor, establishment_id, is_active")
          .eq("establishment_id", establishmentId)
          .eq("is_active", true),
      ]);

      const dbUnits: UnitWithFamily[] = (unitsRes.data ?? []).map((u) => ({
        ...u,
        aliases: u.aliases as string[] | null,
      }));
      const dbConversions: ConversionRule[] = (convsRes.data ?? []) as ConversionRule[];

      // 3. Resolve author names from profiles (posted_by = profiles.user_id)
      const uniqueUserIds = [...new Set(data.map((r) => r.posted_by).filter(Boolean))] as string[];
      const authorMap = new Map<string, string>();

      if (uniqueUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", uniqueUserIds);

        if (profiles) {
          for (const p of profiles) {
            authorMap.set(p.user_id, p.full_name ?? "Utilisateur");
          }
        }
      }

      // 4. Map to flat entries with BFS reconversion
      type UnitJoin = { id: string; name: string } | null;
      type ProductJoin = {
        nom_produit: string;
        stock_handling_unit_id: string | null;
        conditionnement_config: Json | null;
        stock_handling_unit: UnitJoin;
      } | null;

      const rawEntries: WithdrawalHistoryEntry[] = data.map((row) => {
        const product = row.product as ProductJoin;
        const canonicalUnit = row.canonical_unit as UnitJoin;
        const canonicalQty = Math.abs(row.delta_quantity_canonical);
        const canonicalUnitId = row.canonical_unit_id;

        // Try reconversion: canonical → stock_handling_unit → fallback canonical
        const reconverted =
          reconvertToDisplayUnit(
            canonicalQty,
            canonicalUnitId,
            product?.stock_handling_unit?.id ?? null,
            product?.stock_handling_unit?.name ?? null,
            product?.conditionnement_config ?? null,
            dbUnits,
            dbConversions
          );

        // Fallback: canonical quantity + canonical unit name (always coherent)
        const displayQty = reconverted?.quantity ?? canonicalQty;
        const displayUnit = reconverted?.unitName ?? canonicalUnit?.name ?? "";

        return {
          id: row.id,
          posted_at: row.posted_at,
          product_name: product?.nom_produit ?? "Produit inconnu",
          quantity: displayQty,
          unit_name: displayUnit,
          author_name: row.posted_by ? (authorMap.get(row.posted_by) ?? "Utilisateur") : "Utilisateur",
          event_reason: row.event_reason,
        };
      });

      // 5. Merge near-duplicate entries (same product, same author, same minute)
      const mergeKey = (e: WithdrawalHistoryEntry) => {
        const minute = e.posted_at.slice(0, 16); // YYYY-MM-DDTHH:MM
        return `${e.product_name}|${e.author_name}|${e.unit_name}|${minute}`;
      };

      const mergedMap = new Map<string, WithdrawalHistoryEntry>();
      for (const entry of rawEntries) {
        const key = mergeKey(entry);
        const existing = mergedMap.get(key);
        if (existing) {
          existing.quantity += entry.quantity;
        } else {
          mergedMap.set(key, { ...entry });
        }
      }
      const entries = Array.from(mergedMap.values());

      // 6. Group by day
      const groupMap = new Map<string, WithdrawalHistoryEntry[]>();
      for (const entry of entries) {
        const dayKey = entry.posted_at.slice(0, 10); // YYYY-MM-DD
        const group = groupMap.get(dayKey);
        if (group) {
          group.push(entry);
        } else {
          groupMap.set(dayKey, [entry]);
        }
      }

      // 7. Convert to sorted array (most recent day first)
      const groups: WithdrawalDayGroup[] = Array.from(groupMap.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, dayEntries]) => ({ date, entries: dayEntries }));

      return groups;
    },
    enabled: !!establishmentId && !!yearMonth,
  });
}
