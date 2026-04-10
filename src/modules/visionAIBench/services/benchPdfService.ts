/**
 * Service for bench PDF CRUD operations.
 * Extracted from component to follow data-deletion-policy.md:
 * "JAMAIS d'appel direct a .delete() dans un composant React"
 */

import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Hard-delete a bench PDF and its storage file.
 * Bench PDFs are ephemeral test data — hard delete is acceptable.
 */
export async function deleteBenchPdf(pdfId: string, storagePath: string): Promise<void> {
  // 1. Remove storage object (best-effort)
  await supabase.storage
    .from("vision-ia-documents")
    .remove([storagePath])
    .catch(() => {});

  // 2. Delete the bench_pdfs row (CASCADE will delete related bench_runs)
  const { error } = await db.from("bench_pdfs").delete().eq("id", pdfId);
  if (error) throw error;
}
