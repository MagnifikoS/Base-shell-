import { supabase } from "@/integrations/supabase/client";

export type ExportableTable =
  | "products_v2"
  | "invoice_suppliers"
  | "invoices"
  | "invoice_line_items";

const TABLE_CONFIGS: Record<ExportableTable, { label: string; columns: string }> = {
  products_v2: {
    label: "Produits",
    columns:
      "id, code_produit, code_barres, nom_produit, nom_produit_fr, category_id, supplier_billing_unit_id, final_unit_price, final_unit_id, conditionnement_resume, supplier_id, establishment_id, created_at, updated_at, archived_at",
  },
  invoice_suppliers: {
    label: "Fournisseurs",
    columns:
      "id, name, name_normalized, status, supplier_type, internal_code, siret, vat_number, contact_name, contact_email, contact_phone, billing_address, city, postal_code, country, payment_terms, payment_delay_days, payment_method, establishment_id, created_at, updated_at, archived_at",
  },
  invoices: {
    label: "Factures",
    columns:
      "id, invoice_number, invoice_date, amount_eur, supplier_id, supplier_name, is_paid, file_name, file_path, establishment_id, created_at, updated_at",
  },
  invoice_line_items: {
    label: "Lignes de facture",
    columns:
      "id, invoice_id, supplier_id, line_index, raw_label, product_name_snapshot, product_code_snapshot, quantity, unit_price, line_total, unit_of_sale, packaging, category_snapshot, product_id, global_product_id, year_month, establishment_id, created_at",
  },
};

function toCsvString(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const s = typeof val === "object" ? JSON.stringify(val) : String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

function downloadBlob(csv: string, filename: string) {
  const bom = "\uFEFF"; // UTF-8 BOM for Excel
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportTableToCsv(table: ExportableTable): Promise<{ count: number }> {
  const config = TABLE_CONFIGS[table];

  // Fetch all rows (paginate if > 1000)
  let allRows: Record<string, unknown>[] = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select(config.columns)
      .range(from, from + pageSize - 1)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Erreur export ${table}: ${error.message}`);
    const rows = data as unknown as Record<string, unknown>[] | null;
    if (!rows || rows.length === 0) {
      hasMore = false;
    } else {
      allRows = allRows.concat(rows);
      from += pageSize;
      if (rows.length < pageSize) hasMore = false;
    }
  }

  if (allRows.length === 0) {
    throw new Error(`Aucune donnée dans ${config.label}`);
  }

  const csv = toCsvString(allRows);
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(csv, `${table}_${date}.csv`);

  return { count: allRows.length };
}

export function getExportableTables(): { key: ExportableTable; label: string }[] {
  return Object.entries(TABLE_CONFIGS).map(([key, val]) => ({
    key: key as ExportableTable,
    label: val.label,
  }));
}
