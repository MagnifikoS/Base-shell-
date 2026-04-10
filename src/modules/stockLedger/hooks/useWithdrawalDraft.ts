/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useWithdrawalDraft — Manages DRAFT WITHDRAWAL document + lines
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RULES:
 * - Same structure as useReceiptDraft but type = WITHDRAWAL
 * - delta_quantity_canonical is NEGATIVE (enforced at addLine)
 * - event_reason is MANDATORY
 * - Uses same fn_post_stock_document RPC
 * - BUG-01 FIX: Draft is created ONLY via explicit ensureDraft() call (no auto-create on mount)
 *   This prevents race conditions in React StrictMode (double mount = 2 inserts)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import type {
  StockDocument,
  StockDocumentLine,
  StockDocumentType,
  StockDocumentStatus,
} from "../types";
import { useCallback, useMemo, useState } from "react";

export interface EnsureWithdrawalDraftResult {
  ok: boolean;
  documentId?: string;
  error?: string;
}

export function useWithdrawalDraft(zoneId: string | null) {
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const estId = activeEstablishment?.id;
  const orgId = activeEstablishment?.organization_id;

  const [draftError, setDraftError] = useState<string | null>(null);
  const [isDraftCreating, setIsDraftCreating] = useState(false);

  const docQueryKey = useMemo(
    () => ["stock-document-draft", estId, zoneId, "WITHDRAWAL"],
    [estId, zoneId]
  );

  // Load existing DRAFT WITHDRAWAL for this zone
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
        .eq("type", "WITHDRAWAL")
        .eq("status", "DRAFT")
        .maybeSingle();
      if (error) throw error;
      return data as StockDocument | null;
    },
    enabled: !!estId && !!zoneId,
  });

  // ═══ EXPLICIT DRAFT CREATION (user action only — NO useEffect auto-create) ═══
  // BUG-01 FIX: Find-or-create pattern with direct DB query to avoid stale closures
  const ensureDraft = useCallback(async (): Promise<EnsureWithdrawalDraftResult> => {
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
        p_type: "WITHDRAWAL",
      });

      // 1. Always query DB directly — never rely on React state (stale closure)
      const { data: existing, error: fetchErr } = await supabase
        .from("stock_documents")
        .select(
          "id, establishment_id, organization_id, storage_zone_id, supplier_id, type, status, idempotency_key, lock_version, created_by, created_at, posted_at, posted_by, voided_at, voided_by, updated_at"
        )
        .eq("establishment_id", estId)
        .eq("storage_zone_id", zoneId)
        .eq("type", "WITHDRAWAL")
        .eq("status", "DRAFT")
        .maybeSingle();

      if (fetchErr) {
        const msg = `Erreur lecture brouillon: ${fetchErr.message}`;
        setDraftError(msg);
        return { ok: false, error: msg };
      }

      if (existing) {
        // Draft already exists — refresh cache immediately and return
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
          type: "WITHDRAWAL" as StockDocumentType,
          status: "DRAFT" as StockDocumentStatus,
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
            .eq("type", "WITHDRAWAL")
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

  // ═══ ADD LINE (delta forced negative) ═══
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
      // Force negative delta for withdrawals
      const negativeDelta = params.deltaQuantity > 0 ? -params.deltaQuantity : params.deltaQuantity;

      const insertData = {
        document_id: params.documentId,
        product_id: params.productId,
        delta_quantity_canonical: negativeDelta,
        canonical_unit_id: params.canonicalUnitId,
        canonical_family: params.canonicalFamily,
        canonical_label: params.canonicalLabel,
        context_hash: params.contextHash,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_payload: params.inputPayload as any ?? null,
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

  // ═══ UPDATE LINE QUANTITY (kept negative) ═══
  const updateLine = useMutation({
    mutationFn: async (params: {
      lineId: string;
      deltaQuantity: number;
      inputPayload?: Record<string, unknown>;
    }) => {
      const negativeDelta = params.deltaQuantity > 0 ? -params.deltaQuantity : params.deltaQuantity;

      const updateData = {
        delta_quantity_canonical: negativeDelta,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_payload: params.inputPayload as any ?? null,
      };
      const { data, error } = await supabase
        .from("stock_document_lines")
        .update(updateData)
        .eq("id", params.lineId)
        .select()
        .single();
      if (error) throw error;
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

  return {
    document,
    lines,
    isLoading: docLoading || linesLoading,
    isDraftCreating,
    draftError,
    ensureDraft,
    addLine,
    updateLine,
    removeLine,
  };
}
