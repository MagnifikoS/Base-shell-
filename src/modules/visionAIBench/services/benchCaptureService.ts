/**
 * Auto-capture service for Vision AI Bench.
 */

import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface CaptureParams {
  file: File;
  precisionMode: string;
  invoice: {
    supplier_name: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    invoice_total: number | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: Array<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insights: Array<any>;
  establishmentId: string | undefined;
}

const MODEL_MAP: Record<string, { id: string; label: string }> = {
  claude: { id: "claude-sonnet-4-5-20250929", label: "Vision AI" },
  standard: { id: "google/gemini-2.5-flash-lite", label: "Gemini Flash Lite" },
  precise: { id: "mistralai/pixtral-large-2411", label: "Pixtral Large" },
};

export async function benchAutoCapture(params: CaptureParams): Promise<void> {
  const { file, precisionMode, invoice, items, insights, establishmentId } = params;

  if (!establishmentId) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `bench/${establishmentId}/${timestamp}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("vision-ia-documents")
    .upload(storagePath, file, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    if (import.meta.env.DEV) console.warn("[bench-capture] Upload failed:", uploadError.message);
    return;
  }

  const { data: benchPdf, error: pdfInsertError } = await db
    .from("bench_pdfs")
    .insert({
      establishment_id: establishmentId,
      original_filename: file.name,
      storage_path: storagePath,
      file_size_bytes: file.size,
      supplier_name: invoice.supplier_name,
      invoice_number: invoice.invoice_number,
      captured_by: user.id,
    })
    .select("id")
    .single();

  if (pdfInsertError || !benchPdf) {
    if (import.meta.env.DEV)
      console.warn("[bench-capture] PDF insert failed:", pdfInsertError?.message);
    return;
  }

  const model = MODEL_MAP[precisionMode] || MODEL_MAP.claude;

  const { error: runInsertError } = await db.from("bench_runs").insert({
    bench_pdf_id: (benchPdf as Record<string, unknown>).id,
    model_id: model.id,
    model_label: model.label,
    source: "auto-capture",
    status: "success",
    result_invoice: invoice,
    result_items: items,
    result_insights: insights,
    items_count: items.length,
    insights_count: insights.length,
    created_by: user.id,
  });

  if (runInsertError) {
    if (import.meta.env.DEV)
      console.warn("[bench-capture] Run insert failed:", runInsertError.message);
    return;
  }

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[bench-capture] Captured: ${file.name} → ${(benchPdf as Record<string, unknown>).id}`);
  }
}
