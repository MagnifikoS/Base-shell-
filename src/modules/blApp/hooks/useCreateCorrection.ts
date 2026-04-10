/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useCreateCorrection — Creates RECEIPT_CORRECTION document + lines + POST
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Append-only: correction = new stock_document(RECEIPT_CORRECTION) with delta lines.
 * Uses fn_post_stock_document for atomic POST with zone routing.
 * Increments bl_app_documents.corrections_count on success.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { generateIdempotencyKey } from "@/modules/stockLedger";

export interface CorrectionLine {
  product_id: string;
  delta_quantity_canonical: number; // signed: + or -
  canonical_unit_id: string;
  canonical_family: string;
  canonical_label: string | null;
  context_hash: string;
}

export interface CreateCorrectionParams {
  /** The original stock_document_id (the RECEIPT being corrected) */
  originalStockDocumentId: string;
  /** BL-APP document ID (to increment corrections_count) */
  blAppDocumentId: string;
  establishmentId: string;
  organizationId: string;
  /** Default zone for the document header (product zones override at POST) */
  storageZoneId: string;
  supplierId: string | null;
  lines: CorrectionLine[];
}

export interface CorrectionResult {
  ok: boolean;
  error?: string;
  details?: Record<string, unknown>;
  events_created?: number;
}

export function useCreateCorrection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<CorrectionResult, Error, CreateCorrectionParams>({
    mutationFn: async (params) => {
      if (!user?.id) throw new Error("Non authentifié");

      // BL-01: Pre-check that the original document is a POSTED RECEIPT
      const { data: originalDoc, error: origErr } = await supabase
        .from("stock_documents")
        .select("id, type, status")
        .eq("id", params.originalStockDocumentId)
        .single();

      if (origErr || !originalDoc) {
        return { ok: false, error: "Document original introuvable." };
      }
      if (originalDoc.type !== "RECEIPT") {
        return {
          ok: false,
          error: `Le document original est de type ${originalDoc.type}, seuls les RECEIPT peuvent être corrigés.`,
        };
      }
      if (originalDoc.status !== "POSTED") {
        return {
          ok: false,
          error: `Le document original a le statut ${originalDoc.status}, il doit être POSTED pour être corrigé.`,
        };
      }

      // 0. Idempotent: find existing DRAFT or create one (never DELETE)
      const { data: existingDraft } = await supabase
        .from("stock_documents")
        .select()
        .eq("establishment_id", params.establishmentId)
        .eq("storage_zone_id", params.storageZoneId)
        .eq("type", "RECEIPT_CORRECTION")
        .eq("status", "DRAFT")
        .eq("corrects_document_id", params.originalStockDocumentId)
        .maybeSingle();

      let doc = existingDraft;

      if (!doc) {
        const { data: newDoc, error: docErr } = await supabase
          .from("stock_documents")
          .insert({
            establishment_id: params.establishmentId,
            organization_id: params.organizationId,
            storage_zone_id: params.storageZoneId,
            supplier_id: params.supplierId,
            type: "RECEIPT_CORRECTION",
            status: "DRAFT",
            corrects_document_id: params.originalStockDocumentId,
            created_by: user.id,
          })
          .select()
          .single();

        if (docErr || !newDoc) {
          return { ok: false, error: docErr?.message ?? "Failed to create correction document" };
        }
        doc = newDoc;
      } else {
        // Reusing existing draft — clear its old lines so we write fresh ones
        await supabase.from("stock_document_lines").delete().eq("document_id", doc.id);
      }

      // 2. Insert delta lines
      const lineInserts = params.lines.map((l) => ({
        document_id: doc.id,
        product_id: l.product_id,
        delta_quantity_canonical: l.delta_quantity_canonical,
        canonical_unit_id: l.canonical_unit_id,
        canonical_family: l.canonical_family,
        canonical_label: l.canonical_label,
        context_hash: l.context_hash,
      }));

      const { error: linesErr } = await supabase.from("stock_document_lines").insert(lineInserts);

      if (linesErr) {
        // Cleanup the orphan document
        await supabase.from("stock_documents").delete().eq("id", doc.id);
        return { ok: false, error: linesErr.message };
      }

      // 3. POST atomically via Edge Function stock-ledger (fn_post_stock_document is REVOKED from authenticated)
      const idempotencyKey = generateIdempotencyKey(
        doc.id,
        params.establishmentId,
        doc.lock_version ?? 0
      );

      const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
      if (sessionError || !session?.access_token) {
        return { ok: false, error: "Session expirée. Reconnectez-vous." };
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const edgeFnUrl = `${supabaseUrl}/functions/v1/stock-ledger?action=post`;

      const httpRes = await fetch(edgeFnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          document_id: doc.id,
          expected_lock_version: doc.lock_version ?? 0,
          idempotency_key: idempotencyKey,
          event_reason: "RECEIPT_CORRECTION",
        }),
      });

      let result: Record<string, unknown> | null = null;
      try {
        result = await httpRes.json();
      } catch {
        return { ok: false, error: "Invalid JSON response from edge function" };
      }

      if (!httpRes.ok) {
        return {
          ok: false,
          error: (result?.error as string) ?? "RPC_ERROR",
          details: result ?? undefined,
        };
      }

      // 4. Recompute corrections_count from source of truth (P0-4)
      const { count } = await supabase
        .from("stock_documents")
        .select("id", { count: "exact", head: true })
        .eq("corrects_document_id", params.originalStockDocumentId)
        .eq("status", "POSTED");

      await supabase
        .from("bl_app_documents")
        .update({ corrections_count: count ?? 1 })
        .eq("id", params.blAppDocumentId);

      return {
        ok: true,
        events_created: (result?.events_created as number) ?? 0,
      };
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ["bl-app-corrections"] });
        queryClient.invalidateQueries({ queryKey: ["bl-app-cumulative-deltas"] });
        queryClient.invalidateQueries({ queryKey: ["bl-app-documents"] });
        queryClient.invalidateQueries({ queryKey: ["bl-app-lines-with-prices"] });
        queryClient.invalidateQueries({ queryKey: ["stock-documents-posted"] });
        queryClient.invalidateQueries({ queryKey: ["stock-documents-history"] });
        queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
        queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
        queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
      }
    },
  });
}
