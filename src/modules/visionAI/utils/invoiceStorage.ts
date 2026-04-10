/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — Invoice PDF Storage Utilities
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Handles uploading invoice PDFs to Supabase storage.
 * Uses the "invoices" bucket with establishment-scoped paths.
 *
 * Path format: establishments/{establishment_id}/suppliers/{supplier_id}/invoices/{year-month}/{timestamp}_{filename}.pdf
 * This matches the RLS policy that extracts establishment_id from position [2]
 */

import { supabase } from "@/integrations/supabase/client";

const BUCKET_NAME = "invoices";

/**
 * Sanitize filename for storage (remove special characters)
 */
function sanitizeFilename(filename: string): string {
  // Replace all non-alphanumeric chars except dots, hyphens, underscores
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
}

/**
 * Generate a unique storage path for an invoice PDF
 * Format: establishments/{establishment_id}/suppliers/{supplier_id}/invoices/{year-month}/{timestamp}_{filename}.pdf
 */
function generateStoragePath(
  establishmentId: string,
  supplierId: string,
  invoiceDate: string,
  originalFilename: string
): string {
  const yearMonth = invoiceDate.substring(0, 7); // YYYY-MM
  const timestamp = Date.now();
  const safeName = sanitizeFilename(originalFilename);

  return `establishments/${establishmentId}/suppliers/${supplierId}/invoices/${yearMonth}/${timestamp}_${safeName}`;
}

/**
 * Upload a PDF file to the invoices bucket
 * @returns The storage path if successful, null otherwise
 */
export async function uploadInvoicePdf(
  file: File,
  establishmentId: string,
  supplierId: string,
  invoiceDate: string
): Promise<{
  success: boolean;
  path?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
}> {
  try {
    const storagePath = generateStoragePath(establishmentId, supplierId, invoiceDate, file.name);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, file, {
        contentType: "application/pdf",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      if (import.meta.env.DEV) console.error("[invoiceStorage] Upload error:", uploadError);
      return {
        success: false,
        error: uploadError.message || "Erreur lors de l'upload du PDF",
      };
    }

    return {
      success: true,
      path: storagePath,
      fileName: file.name,
      fileSize: file.size,
    };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[invoiceStorage] Unexpected upload error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inattendue",
    };
  }
}

/**
 * Delete an invoice PDF from storage
 */
export async function deleteInvoicePdf(storagePath: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage.from(BUCKET_NAME).remove([storagePath]);

    if (error) {
      if (import.meta.env.DEV) console.warn("[invoiceStorage] Delete warning:", error);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
