/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useReceiptDraft — Manages DRAFT RECEIPT document + lines
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RULES:
 * - Zone is resolved from establishment_stock_settings (default receipt zone)
 * - DRAFT is created ONLY on explicit user action (ensureDraft)
 * - NO auto-create on mount or after POST
 * - Lines CRUD only while DRAFT
 * - No stock calculation — display only
 * - Context hash computed at line creation time
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDefaultReceiptZone } from "./useDefaultReceiptZone";
import type { StockDocument, StockDocumentLine } from "../types";
import type { Database } from "@/integrations/supabase/types";
import { useCallback, useMemo, useState } from "react";

export interface EnsureDraftResult {
  ok: boolean;
  documentId?: string;
  error?: string;
}

export function useReceiptDraft() {
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const estId = activeEstablishment?.id;
  const orgId = activeEstablishment?.organization_id;
  const {
    defaultZone,
    isLoading: zoneLoading,
    isMissing: zoneMissing,
    needsSelection: zoneNeedsSelection,
    availableZones,
    setSelectedZoneId: setReceiptZoneId,
    isManualSelection: zoneIsManualSelection,
  } = useDefaultReceiptZone();
  const zoneId = defaultZone?.zoneId ?? null;

  // Draft creation error state (surfaced to UI)
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isDraftCreating, setIsDraftCreating] = useState(false);

  const docQueryKey = useMemo(
    () => ["stock-document-draft", estId, zoneId, "RECEIPT"],
    [estId, zoneId]
  );

  // Load existing DRAFT RECEIPT for the default zone
  const { data: document, isLoading: docLoading } = useQuery({
    queryKey: docQueryKey,
    queryFn: async () => {
      if (!estId || !zoneId) return null;
      const { data, error } = await supabase
        .from("stock_documents")
        .select(
          "id, establishment_id, organization_id, storage_zone_id, supplier_id, type, status, idempotency_key, lock_version, created_by, created_at, posted_at, posted_by, voided_at, voided_by, updated_at"
        )
        .eq("establishment_id", estId)
        .eq("storage_zone_id", zoneId)
        .eq("type", "RECEIPT")
        .eq("status", "DRAFT")
        .maybeSingle();
      if (error) throw error;
      return data as StockDocument | null;
    },
    enabled: !!estId && !!zoneId,
  });

  // ═══ EXPLICIT DRAFT CREATION (user action only, never auto) ═══
  // Returns the document ID directly — no stale closure dependency
  const ensureDraft = useCallback(async (): Promise<EnsureDraftResult> => {
    if (!estId || !orgId || !zoneId || !user?.id) {
      const msg =
        "Paramètres manquants pour créer le brouillon (établissement, zone ou utilisateur).";
      setDraftError(msg);
      return { ok: false, error: msg };
    }

    setDraftError(null);
    setIsDraftCreating(true);

    try {
      // 0. Auto-abandon stale DRAFTs (>15 min) before attempting find-or-create
      await supabase.rpc("fn_abandon_stale_drafts", {
        p_establishment_id: estId,
        p_storage_zone_id: zoneId,
        p_type: "RECEIPT",
      });

      // 1. Always query DB directly — never rely on React state (stale closure)
      const { data: existing, error: fetchErr } = await supabase
        .from("stock_documents")
        .select(
          "id, establishment_id, organization_id, storage_zone_id, supplier_id, type, status, idempotency_key, lock_version, created_by, created_at, posted_at, posted_by, voided_at, voided_by, updated_at"
        )
        .eq("establishment_id", estId)
        .eq("storage_zone_id", zoneId)
        .eq("type", "RECEIPT")
        .eq("status", "DRAFT")
        .maybeSingle();

      if (fetchErr) {
        const msg = `Erreur lecture brouillon: ${fetchErr.message}`;
        setDraftError(msg);
        return { ok: false, error: msg };
      }

      if (existing) {
        // Draft already exists — refresh cache and return
        queryClient.setQueryData(docQueryKey, existing);
        return { ok: true, documentId: existing.id };
      }

      // 2. No draft exists — create one
      const { data: newDoc, error: insertErr } = await supabase
        .from("stock_documents")
        .insert({
          establishment_id: estId,
          organization_id: orgId,
          storage_zone_id: zoneId,
          supplier_id: null,
          type: "RECEIPT" as Database["public"]["Enums"]["stock_document_type"],
          status: "DRAFT" as Database["public"]["Enums"]["stock_document_status"],
          created_by: user.id,
        })
        .select()
        .single();

      if (insertErr) {
        // Unique constraint = another device created it concurrently
        if (
          insertErr.message?.includes("duplicate key") ||
          insertErr.message?.includes("uq_stock_documents")
        ) {
          // Re-fetch to get the one that was just created
          const { data: refetched } = await supabase
            .from("stock_documents")
            .select(
              "id, establishment_id, organization_id, storage_zone_id, supplier_id, type, status, idempotency_key, lock_version, created_by, created_at, posted_at, posted_by, voided_at, voided_by, updated_at"
            )
            .eq("establishment_id", estId)
            .eq("storage_zone_id", zoneId)
            .eq("type", "RECEIPT")
            .eq("status", "DRAFT")
            .maybeSingle();
          if (refetched) {
            queryClient.setQueryData(docQueryKey, refetched);
            return { ok: true, documentId: refetched.id };
          }
        }
        const msg = `Erreur création brouillon: ${insertErr.message}`;
        setDraftError(msg);
        return { ok: false, error: msg };
      }

      // 3. Success — update cache directly (no invalidation delay)
      queryClient.setQueryData(docQueryKey, newDoc);
      return { ok: true, documentId: newDoc!.id };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Erreur inconnue lors de la création du brouillon.";
      setDraftError(msg);
      return { ok: false, error: msg };
    } finally {
      setIsDraftCreating(false);
    }
  }, [estId, orgId, zoneId, user?.id, queryClient, docQueryKey]);

  // Load lines for the current DRAFT
  const linesQueryKey = ["stock-document-lines", document?.id];
  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: linesQueryKey,
    queryFn: async () => {
      if (!document?.id) return [];
      const { data, error } = await supabase
        .from("stock_document_lines")
        .select(
          "id, document_id, product_id, input_payload, delta_quantity_canonical, canonical_unit_id, canonical_family, canonical_label, context_hash, created_at, updated_at"
        )
        .eq("document_id", document.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as StockDocumentLine[];
    },
    enabled: !!document?.id,
  });

  // ═══ ADD LINE ═══
  const addLine = useMutation({
    mutationFn: async (params: {
      documentId: string;
      productId: string;
      deltaQuantity: number;
      canonicalUnitId: string;
      canonicalFamily: string;
      canonicalLabel: string | null;
      contextHash: string;
      inputPayload?: Record<string, unknown>;
    }) => {
      // Guard: product must have a storage_zone_id assigned
      const { data: product, error: prodErr } = await supabase
        .from("products_v2")
        .select("storage_zone_id")
        .eq("id", params.productId)
        .single();
      if (prodErr) throw prodErr;
      if (!product?.storage_zone_id) {
        throw new Error(
          "PRODUCT_NO_ZONE: Ce produit n'a pas de zone de stockage assignée. Veuillez configurer sa zone dans la fiche produit avant de le réceptionner."
        );
      }

      const insertData: Database["public"]["Tables"]["stock_document_lines"]["Insert"] = {
        document_id: params.documentId,
        product_id: params.productId,
        delta_quantity_canonical: params.deltaQuantity,
        canonical_unit_id: params.canonicalUnitId,
        canonical_family: params.canonicalFamily,
        canonical_label: params.canonicalLabel,
        context_hash: params.contextHash,
        input_payload: params.inputPayload ? JSON.parse(JSON.stringify(params.inputPayload)) : null,
      };
      const { data, error } = await supabase
        .from("stock_document_lines")
        .insert(insertData)
        .select()
        .single();
      if (error) {
        if (error.message.includes("stock_document_lines_document_id_product_id_key")) {
          throw new Error("Ce produit est déjà dans le brouillon.");
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: linesQueryKey });
    },
  });

  // ═══ UPDATE LINE QUANTITY ═══
  const updateLine = useMutation({
    mutationFn: async (params: {
      lineId: string;
      deltaQuantity: number;
      inputPayload?: Record<string, unknown>;
    }) => {
      const updateData: Database["public"]["Tables"]["stock_document_lines"]["Update"] = {
        delta_quantity_canonical: params.deltaQuantity,
        input_payload: params.inputPayload ? JSON.parse(JSON.stringify(params.inputPayload)) : null,
      };
      const { data, error, count } = await supabase
        .from("stock_document_lines")
        .update(updateData)
        .eq("id", params.lineId)
        .select()
        .single();
      if (error) throw error;
      if (count === 0) throw new Error("NO_ROW_UPDATED");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: linesQueryKey });
    },
  });

  // ═══ REMOVE LINE ═══
  const removeLine = useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await supabase.from("stock_document_lines").delete().eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: linesQueryKey });
    },
  });

  // ═══ UPDATE SUPPLIER ═══
  const updateSupplier = useMutation({
    mutationFn: async (params: { documentId: string; supplierId: string | null }) => {
      const { error } = await supabase
        .from("stock_documents")
        .update({ supplier_id: params.supplierId })
        .eq("id", params.documentId)
        .eq("status", "DRAFT");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: docQueryKey });
    },
  });

  return {
    document,
    lines,
    isLoading: docLoading || linesLoading || zoneLoading,
    isDraftCreating,
    draftError,
    defaultZone,
    zoneMissing,
    zoneNeedsSelection,
    availableZones,
    setReceiptZoneId,
    zoneIsManualSelection,
    ensureDraft,
    addLine,
    updateLine,
    removeLine,
    updateSupplier,
  };
}
