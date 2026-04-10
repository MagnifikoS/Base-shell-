import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, AlertTriangle, MinusCircle, PlusCircle } from "lucide-react";
import { diffItems, type DiffRow, type DiffStatus } from "../../lib/itemMatching";
import type { ScanRun } from "../../types/scanHistory";

interface ScanRunComparisonProps {
  runA: ScanRun;
  runB: ScanRun;
}

const STATUS_CONFIG: Record<DiffStatus, { bg: string; icon: React.ElementType; label: string }> = {
  match: { bg: "bg-green-50 dark:bg-green-950/30", icon: CheckCircle2, label: "Identique" },
  price_diff: { bg: "bg-yellow-50 dark:bg-yellow-950/30", icon: AlertTriangle, label: "Écart" },
  missing_in_b: { bg: "bg-red-50 dark:bg-red-950/30", icon: MinusCircle, label: "Absent" },
  extra_in_b: { bg: "bg-orange-50 dark:bg-orange-950/30", icon: PlusCircle, label: "Extra" },
};

function formatPrice(v: number | null): string {
  return v != null ? `${v.toFixed(2)} €` : "—";
}

function formatQty(v: number | null): string {
  return v != null ? String(v) : "—";
}

export function ScanRunComparison({ runA, runB }: ScanRunComparisonProps) {
  const diff = useMemo(() => {
    const a = runA.result_items ?? [];
    const b = runB.result_items ?? [];
    return diffItems(a, b);
  }, [runA.result_items, runB.result_items]);

  const stats = useMemo(() => {
    const s = { match: 0, price_diff: 0, missing_in_b: 0, extra_in_b: 0 };
    for (const row of diff) s[row.status]++;
    return s;
  }, [diff]);

  // Invoice field comparison
  const invoiceA = runA.result_invoice;
  const invoiceB = runB.result_invoice;

  return (
    <div className="space-y-4">
      {/* Summary badges */}
      <div className="flex flex-wrap gap-2">
        {stats.match > 0 && (
          <Badge
            variant="outline"
            className="text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 text-xs"
          >
            {stats.match} identiques
          </Badge>
        )}
        {stats.price_diff > 0 && (
          <Badge
            variant="outline"
            className="text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30 text-xs"
          >
            {stats.price_diff} écarts
          </Badge>
        )}
        {stats.missing_in_b > 0 && (
          <Badge
            variant="outline"
            className="text-red-600 dark:text-red-400 border-red-200 bg-red-50 dark:bg-red-950/30 text-xs"
          >
            {stats.missing_in_b} absents
          </Badge>
        )}
        {stats.extra_in_b > 0 && (
          <Badge
            variant="outline"
            className="text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 text-xs"
          >
            {stats.extra_in_b} extras
          </Badge>
        )}
      </div>

      {/* Invoice fields comparison */}
      {invoiceA && invoiceB && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-2">Champs facture</h4>
          <div className="rounded border border-border/50 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30">
                  <th className="text-left px-2 py-1.5 font-medium">Champ</th>
                  <th className="text-left px-2 py-1.5 font-medium">Run A</th>
                  <th className="text-left px-2 py-1.5 font-medium">Run B</th>
                </tr>
              </thead>
              <tbody>
                <InvoiceFieldRow
                  label="Fournisseur"
                  a={invoiceA.supplier_name}
                  b={invoiceB.supplier_name}
                />
                <InvoiceFieldRow
                  label="Numéro"
                  a={invoiceA.invoice_number}
                  b={invoiceB.invoice_number}
                />
                <InvoiceFieldRow label="Date" a={invoiceA.invoice_date} b={invoiceB.invoice_date} />
                <InvoiceFieldRow
                  label="Total TTC"
                  a={
                    invoiceA.invoice_total != null ? `${invoiceA.invoice_total.toFixed(2)} €` : null
                  }
                  b={
                    invoiceB.invoice_total != null ? `${invoiceB.invoice_total.toFixed(2)} €` : null
                  }
                />
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Separator />

      {/* Items diff table */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-2">
          Produits ({diff.length} lignes)
        </h4>
        <div className="rounded border border-border/50 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30">
                <th className="text-left px-2 py-1.5 font-medium w-6" />
                <th className="text-left px-2 py-1.5 font-medium">Produit A</th>
                <th className="text-left px-2 py-1.5 font-medium">Produit B</th>
                <th className="text-right px-2 py-1.5 font-medium w-16">Qté A</th>
                <th className="text-right px-2 py-1.5 font-medium w-16">Qté B</th>
                <th className="text-right px-2 py-1.5 font-medium w-20">Prix A</th>
                <th className="text-right px-2 py-1.5 font-medium w-20">Prix B</th>
              </tr>
            </thead>
            <tbody>
              {diff.map((row, i) => (
                <DiffRowComponent key={i} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DiffRowComponent({ row }: { row: DiffRow }) {
  const config = STATUS_CONFIG[row.status];
  const Icon = config.icon;

  return (
    <tr className={`border-t border-border/30 ${config.bg}`}>
      <td className="px-2 py-1.5">
        <Icon className="h-3.5 w-3.5" />
      </td>
      <td className="px-2 py-1.5 truncate max-w-[120px]" title={row.nameA ?? undefined}>
        {row.nameA || "—"}
      </td>
      <td className="px-2 py-1.5 truncate max-w-[120px]" title={row.nameB ?? undefined}>
        {row.nameB || "—"}
      </td>
      <td className="text-right px-2 py-1.5 text-muted-foreground">{formatQty(row.qtyA)}</td>
      <td className="text-right px-2 py-1.5 text-muted-foreground">{formatQty(row.qtyB)}</td>
      <td className="text-right px-2 py-1.5">{formatPrice(row.priceA)}</td>
      <td className="text-right px-2 py-1.5">{formatPrice(row.priceB)}</td>
    </tr>
  );
}

function InvoiceFieldRow({ label, a, b }: { label: string; a: string | null; b: string | null }) {
  const isMatch = a === b;
  return (
    <tr
      className={`border-t border-border/30 ${isMatch ? "" : "bg-yellow-50 dark:bg-yellow-950/30"}`}
    >
      <td className="px-2 py-1.5 text-muted-foreground">{label}</td>
      <td className="px-2 py-1.5 font-medium">{a || "—"}</td>
      <td className="px-2 py-1.5 font-medium">{b || "—"}</td>
    </tr>
  );
}
