/**
 * Types for the Facture App module — isolated, no external dependency.
 */

export interface AppInvoice {
  id: string;
  invoice_number: string;
  commande_id: string;
  order_number_snapshot: string;
  supplier_establishment_id: string;
  client_establishment_id: string;
  supplier_name_snapshot: string;
  supplier_address_snapshot: string | null;
  supplier_siret_snapshot: string | null;
  supplier_logo_url_snapshot: string | null;
  client_name_snapshot: string;
  client_address_snapshot: string | null;
  client_siret_snapshot: string | null;
  total_ht: number;
  vat_rate: number | null;
  vat_amount: number | null;
  total_ttc: number | null;
  invoice_date: string;
  commande_date_snapshot: string | null;
  status: "emise" | "annulee";
  created_by: string;
  created_at: string;
}

export interface AppInvoiceLine {
  id: string;
  app_invoice_id: string;
  commande_line_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_label_snapshot: string | null;
  canonical_unit_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
  /** Snapshotted billing unit fields (added migration) — null for legacy invoices */
  billed_unit_id: string | null;
  billed_unit_label: string | null;
  billed_quantity: number | null;
  billed_unit_price: number | null;
}

export interface AppInvoiceWithLines extends AppInvoice {
  lines: AppInvoiceLine[];
}
