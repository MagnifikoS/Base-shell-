/** Captured PDF metadata for benchmarking corpus */
export interface BenchPdf {
  id: string;
  establishment_id: string;
  original_filename: string;
  storage_path: string;
  file_size_bytes: number | null;
  supplier_name: string | null;
  invoice_number: string | null;
  tags: string[];
  notes: string | null;
  captured_at: string;
  captured_by: string | null;
  /** UUID of the run marked as reference for scoring */
  reference_run_id: string | null;
  /** Computed: number of associated runs */
  runs_count?: number;
}

/** Individual extraction run result */
export interface BenchRun {
  id: string;
  bench_pdf_id: string;
  model_id: string;
  model_label: string;
  prompt_version: string;
  source: "auto-capture" | "manual";
  duration_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: number | null;
  result_invoice: BenchInvoice | null;
  result_items: BenchItem[] | null;
  result_insights: BenchInsight[] | null;
  items_count: number;
  insights_count: number;
  raw_ai_content: string | null;
  status: "pending" | "running" | "success" | "error";
  error_message: string | null;
  created_at: string;
  created_by: string | null;
}

export interface BenchInvoice {
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_total: number | null;
}

export interface BenchItem {
  code_produit: string | null;
  nom_produit_complet: string;
  info_produit: string | null;
  quantite_commandee: number | null;
  prix_total_ligne: number | null;
  contenu_facture: string | null;
  category_suggestion?: { label: string; confidence: number };
  price_missing?: boolean;
  has_price_cell?: boolean | null;
}

export interface BenchInsight {
  label: string;
  value: string;
}

export interface BenchModel {
  id: string;
  label: string;
  provider: string;
  tier: "light" | "standard" | "premium";
  pricingPer1M: { input: number; output: number };
  contextWindow: number;
  notes?: string;
}

/** Progress state for bench import operation */
export interface ImportProgress {
  total: number;
  current: number;
  imported: number;
  skipped: number;
  errors: number;
  currentFile: string;
  done: boolean;
}

/** Scoring result comparing a run against a reference run */
export interface BenchScore {
  overall: number;
  invoice: number;
  items: number;
  itemsRecall: number;
  itemsPrecision: number;
  insights: number;
  performance: number;
  missedItems: string[];
  extraItems: string[];
  priceDiffs: Array<{ name: string; expected: number; got: number }>;
}
