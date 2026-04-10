/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useDocumentsHistory — Fetch POSTED/VOID stock documents with filters
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { Database } from "@/integrations/supabase/types";

export interface HistoryDocument {
  id: string;
  type: string;
  status: string;
  storage_zone_id: string;
  supplier_id: string | null;
  lock_version: number;
  created_at: string;
  posted_at: string | null;
  voided_at: string | null;
  posted_by: string | null;
  voided_by: string | null;
  lines_count: number;
  supplier_name: string | null;
  zone_name: string | null;
  bl_number: string | null;
}

interface Filters {
  zoneId?: string | null;
  supplierId?: string | null;
  documentType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export function useDocumentsHistory(filters: Filters = {}) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["stock-documents-history", estId, filters],
    queryFn: async () => {
      if (!estId) return [];

      // Fetch documents
      const query = supabase
        .from("stock_documents")
        .select(
          "id, type, status, storage_zone_id, supplier_id, lock_version, created_at, posted_at, voided_at, posted_by, voided_by"
        )
        .eq("establishment_id", estId)
        .or("status.eq.POSTED,status.eq.VOID")
        .order("posted_at", { ascending: false, nullsFirst: false })
        .limit(100);

      if (filters.zoneId) {
        query.eq("storage_zone_id", filters.zoneId);
      }
      if (filters.supplierId) {
        query.eq("supplier_id", filters.supplierId);
      }
      if (filters.documentType) {
        query.eq(
          "type",
          filters.documentType as Database["public"]["Enums"]["stock_document_type"]
        );
      }
      if (filters.startDate) {
        query.gte("posted_at", `${filters.startDate}T00:00:00`);
      }
      if (filters.endDate) {
        query.lte("posted_at", `${filters.endDate}T23:59:59`);
      }

      const { data: docs, error } = await query;
      if (error) throw error;
      if (!docs || docs.length === 0) return [];

      // API-PERF-015: Parallelize supplementary queries
      const docIds = docs.map((d) => d.id);
      const supplierIds = [
        ...new Set(docs.filter((d) => d.supplier_id).map((d) => d.supplier_id!)),
      ];
      const zoneIds = [...new Set(docs.map((d) => d.storage_zone_id))];

      const [linesResult, suppliersResult, zonesResult, blResult] = await Promise.all([
        // Lines count
        supabase.from("stock_document_lines").select("document_id").in("document_id", docIds),
        // Supplier names
        supplierIds.length > 0
          ? supabase.from("invoice_suppliers").select("id, name").in("id", supplierIds)
          : Promise.resolve({ data: [] }),
        // Zone names
        zoneIds.length > 0
          ? supabase.from("storage_zones").select("id, name").in("id", zoneIds)
          : Promise.resolve({ data: [] }),
        // BL numbers
        supabase
          .from("bl_app_documents")
          .select("stock_document_id, bl_number")
          .in("stock_document_id", docIds),
      ]);

      const linesMap = new Map<string, number>();
      for (const l of linesResult.data ?? []) {
        linesMap.set(l.document_id, (linesMap.get(l.document_id) ?? 0) + 1);
      }

      const supplierMap = new Map<string, string>();
      for (const s of (suppliersResult.data ?? []) as { id: string; name: string }[]) {
        supplierMap.set(s.id, s.name);
      }

      const zoneMap = new Map<string, string>();
      for (const z of (zonesResult.data ?? []) as { id: string; name: string }[]) {
        zoneMap.set(z.id, z.name);
      }

      const blMap = new Map<string, string>();
      for (const bl of (blResult.data ?? []) as {
        stock_document_id: string;
        bl_number: string | null;
      }[]) {
        if (bl.bl_number) blMap.set(bl.stock_document_id, bl.bl_number);
      }

      return docs.map(
        (d): HistoryDocument => ({
          ...d,
          lines_count: linesMap.get(d.id) ?? 0,
          supplier_name: d.supplier_id ? (supplierMap.get(d.supplier_id) ?? null) : null,
          zone_name: zoneMap.get(d.storage_zone_id) ?? null,
          bl_number: blMap.get(d.id) ?? null,
        })
      );
    },
    enabled: !!estId,
  });
}
