/**
 * Import invoices from the Factures module into Vision AI Bench corpus.
 */

import { supabase } from "@/integrations/supabase/client";
import * as store from "./benchImportStore";
import type { ImportProgress } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export async function importInvoicesToBench(
  establishmentId: string
): Promise<{ imported: number; skipped: number; errors: number }> {
  if (store.getSnapshot().isImporting) {
    return { imported: 0, skipped: 0, errors: 0 };
  }

  store.setImporting(establishmentId);

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Non authentifié");

    const { data: invoices, error: invError } = await supabase
      .from("invoices")
      .select("id, file_path, file_name, file_size, supplier_name, invoice_number, invoice_date, amount_eur")
      .eq("establishment_id", establishmentId)
      .order("invoice_date", { ascending: false });

    if (invError) throw new Error(`Erreur chargement factures: ${invError.message}`);
    if (!invoices || invoices.length === 0) {
      const result = { imported: 0, skipped: 0, errors: 0 };
      store.setDone(result);
      return result;
    }

    const { data: existingBench } = await db
      .from("bench_pdfs")
      .select("original_filename, invoice_number")
      .eq("establishment_id", establishmentId);

    const existingRows = (existingBench || []) as Record<string, unknown>[];
    const existingFilenames = new Set(existingRows.map((b) => b.original_filename as string));
    const existingInvoiceNumbers = new Set(
      existingRows.map((b) => b.invoice_number as string).filter(Boolean)
    );

    const progress: ImportProgress = {
      total: invoices.length,
      current: 0,
      imported: 0,
      skipped: 0,
      errors: 0,
      currentFile: "",
      done: false,
    };

    for (const inv of invoices) {
      progress.current++;
      progress.currentFile = inv.file_name || "—";
      store.setProgress({ ...progress });

      if (existingFilenames.has(inv.file_name)) { progress.skipped++; continue; }
      if (inv.invoice_number && existingInvoiceNumbers.has(inv.invoice_number)) { progress.skipped++; continue; }

      try {
        const { data: blob, error: dlError } = await supabase.storage
          .from("invoices")
          .download(inv.file_path);

        if (dlError || !blob) { progress.errors++; continue; }

        const timestamp = Date.now();
        const safeName = (inv.file_name || "invoice.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `bench/${establishmentId}/${timestamp}_${safeName}`;

        const { error: upError } = await supabase.storage
          .from("vision-ia-documents")
          .upload(storagePath, blob, { contentType: "application/pdf", upsert: false });

        if (upError) { progress.errors++; continue; }

        const { error: insertError } = await db.from("bench_pdfs").insert({
          establishment_id: establishmentId,
          original_filename: inv.file_name,
          storage_path: storagePath,
          file_size_bytes: inv.file_size || null,
          supplier_name: inv.supplier_name || null,
          invoice_number: inv.invoice_number || null,
          captured_by: user.id,
        });

        if (insertError) {
          await supabase.storage.from("vision-ia-documents").remove([storagePath]);
          progress.errors++;
          continue;
        }

        progress.imported++;
        existingFilenames.add(inv.file_name);
        if (inv.invoice_number) existingInvoiceNumbers.add(inv.invoice_number);
      } catch {
        progress.errors++;
      }
    }

    progress.done = true;
    const result = { imported: progress.imported, skipped: progress.skipped, errors: progress.errors };
    store.setDone(result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    store.setError(message);
    throw err;
  }
}
