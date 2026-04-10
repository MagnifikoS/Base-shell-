/**
 * ═══════════════════════════════════════════════════════════════════════════
 * usePostDocument — Calls stock-ledger edge function to post a document
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RULES:
 * - Calls the stock-ledger edge function (uses service_role internally)
 * - fn_post_stock_document is REVOKED from authenticated users (security)
 * - Only the edge function (service_role) can call fn_post_stock_document
 * - Handles all error codes from the edge function response
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { generateIdempotencyKey } from "../engine/postGuards";

export type PostError =
  | "DOCUMENT_NOT_FOUND"
  | "NOT_DRAFT"
  | "NO_ACTIVE_SNAPSHOT"
  | "NO_ACTIVE_SNAPSHOT_FOR_PRODUCT_ZONE"
  | "PRODUCT_NO_ZONE"
  | "FAMILY_MISMATCH"
  | "NO_LINES"
  | "WITHDRAWAL_REASON_REQUIRED"
  | "LOCK_CONFLICT"
  | "RPC_ERROR";

export interface PostResult {
  ok: boolean;
  error?: PostError;
  details?: Record<string, unknown>;
  idempotent?: boolean;
  events_created?: number;
  warnings?: string[];
}

/** Known guard codes that can appear in RPC error messages */
const KNOWN_GUARDS: PostError[] = [
  "PRODUCT_NO_ZONE",
  "NO_ACTIVE_SNAPSHOT_FOR_PRODUCT_ZONE",
  "NO_ACTIVE_SNAPSHOT",
  "FAMILY_MISMATCH",
  "LOCK_CONFLICT",
  "NO_LINES",
  "NOT_DRAFT",
  "DOCUMENT_NOT_FOUND",
];

/**
 * Extract a known guard code from an RPC error message.
 * The DB function often raises exceptions with the guard code embedded in the message text.
 */
function extractGuardFromMessage(message: string): PostError | null {
  for (const guard of KNOWN_GUARDS) {
    if (message.includes(guard)) return guard;
  }
  return null;
}

// Stock Zéro Simple V2: no override params needed

export function usePostDocument() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const postMutation = useMutation({
    mutationFn: async (params: {
      documentId: string;
      establishmentId: string;
      expectedLockVersion: number;
      eventReason?: string;
    }): Promise<PostResult> => {
      if (!user?.id) throw new Error("Non authentifié");

      const idempotencyKey = generateIdempotencyKey(
        params.documentId,
        params.establishmentId,
        params.expectedLockVersion
      );

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[usePostDocument] posting document:", params.documentId, "lockVersion:", params.expectedLockVersion);
      }


      // Call the stock-ledger edge function via native fetch to properly read
      // JSON error bodies on non-2xx responses (supabase.functions.invoke swallows
      // the body and only returns "Edge Function returned a non-2xx status code").
      // Use refreshSession() to ensure we have a fresh, valid token — getSession()
      // can return a cached expired token that causes UNAUTHORIZED errors.
      const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
      if (sessionError || !session?.access_token) {
        return { ok: false, error: "RPC_ERROR" as PostError, details: { message: "Session expirée. Reconnectez-vous." } };
      }
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const edgeFnUrl = `${supabaseUrl}/functions/v1/stock-ledger?action=post`;

      const httpRes = await fetch(edgeFnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          document_id: params.documentId,
          expected_lock_version: params.expectedLockVersion,
          idempotency_key: idempotencyKey,
          event_reason: params.eventReason ?? null,
        }),
      });

      let result: Record<string, unknown> | null = null;
      try {
        result = await httpRes.json();
      } catch {
        return { ok: false, error: "RPC_ERROR", details: { message: "Invalid JSON response from edge function" } };
      }

      if (!httpRes.ok) {
        if (import.meta.env.DEV) {
          console.error("[usePostDocument] edge function error:", httpRes.status, result);
        }
        const errCode = (result?.error as string) ?? "";

        // Stock Zéro Simple V2: NEGATIVE_STOCK no longer exists
        if (errCode === "WITHDRAWAL_REASON_REQUIRED" || errCode.includes("WITHDRAWAL_REASON_REQUIRED")) {
          return {
            ok: false,
            error: "WITHDRAWAL_REASON_REQUIRED",
            details: { message: "Le motif est obligatoire pour un retrait." },
          };
        }
        const extractedGuard = extractGuardFromMessage(errCode);
        return {
          ok: false,
          error: extractedGuard ?? (result?.error as PostError) ?? "RPC_ERROR",
          details: result ?? { message: `HTTP ${httpRes.status}` },
        };
      }

      return {
        ok: true,
        idempotent: (result?.idempotent as boolean) ?? false,
        events_created: (result?.events_created as number) ?? 0,
        warnings: (result?.warnings as string[]) ?? [],
      };
    },
    onSuccess: (result) => {
      if (result.ok) {
        // Invalidate all related queries
        queryClient.invalidateQueries({ queryKey: ["stock-document-draft"] });
        queryClient.invalidateQueries({ queryKey: ["stock-document-lines"] });
        queryClient.invalidateQueries({ queryKey: ["stock-documents-posted"] });
        queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
        queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
        queryClient.invalidateQueries({ queryKey: ["product-current-stock"] });
        queryClient.invalidateQueries({ queryKey: ["product-has-stock"] });
        queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
      }
    },
  });

  return {
    post: postMutation.mutateAsync,
    isPosting: postMutation.isPending,
  };
}
