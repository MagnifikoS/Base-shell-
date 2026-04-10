/**
 * AppInvoiceDetailSheet — View invoice detail in a bottom sheet
 *
 * DISPLAY RULE: unit_price is reconverted to the line unit (canonical_unit_id)
 * so that price and quantity share the same unit (e.g. 7.60 €/kg not 0.0076 €/g).
 */

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, Building2, Download } from "lucide-react";
import { useAppInvoiceDetail } from "../hooks/useFactureApp";
import { useInvoiceDisplayPrices } from "../hooks/useInvoiceDisplayPrices";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { generateInvoicePdf } from "../services/generateInvoicePdf";
import { displayProductName } from "@/utils/displayName";

interface Props {
  invoiceId: string | null;
  open: boolean;
  onClose: () => void;
}

function fmtEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function fmtDate(d: string): string {
  const parts = d.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
}

export function AppInvoiceDetailSheet({ invoiceId, open, onClose }: Props) {
  const { data, isLoading } = useAppInvoiceDetail(open ? invoiceId : null);
  const displayLines = useInvoiceDisplayPrices(data?.lines);
  const isMobile = useIsMobile();
  const [downloading, setDownloading] = useState(false);

  const handleDownloadPdf = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      const blob = await generateInvoicePdf(data, displayLines);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          isMobile ? "max-h-[90vh] rounded-t-2xl" : "sm:max-w-lg",
          "overflow-y-auto"
        )}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <FileText className="h-5 w-5 text-primary" />
            {data?.invoice_number ?? "Facture"}
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data ? (
          <div className="mt-4 space-y-4">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-muted/50 border border-border">
                <div className="flex items-center gap-1.5 mb-1">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Fournisseur</span>
                </div>
                <p className="text-sm font-semibold">{data.supplier_name_snapshot}</p>
                {data.supplier_address_snapshot && (
                  <p className="text-xs text-muted-foreground mt-0.5">{data.supplier_address_snapshot}</p>
                )}
                {data.supplier_siret_snapshot && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">SIRET: {data.supplier_siret_snapshot}</p>
                )}
              </div>
              <div className="p-3 rounded-lg bg-muted/50 border border-border">
                <div className="flex items-center gap-1.5 mb-1">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Client</span>
                </div>
                <p className="text-sm font-semibold">{data.client_name_snapshot}</p>
                {data.client_address_snapshot && (
                  <p className="text-xs text-muted-foreground mt-0.5">{data.client_address_snapshot}</p>
                )}
                {data.client_siret_snapshot && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">SIRET: {data.client_siret_snapshot}</p>
                )}
              </div>
            </div>

            {/* Metadata */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>N° Facture</span>
                <span className="text-foreground font-medium">{data.invoice_number}</span>
              </div>
              <div className="flex justify-between">
                <span>N° Commande</span>
                <span className="text-foreground font-medium">{data.order_number_snapshot}</span>
              </div>
              <div className="flex justify-between">
                <span>Date facture</span>
                <span className="text-foreground font-medium">{fmtDate(data.invoice_date)}</span>
              </div>
              {data.commande_date_snapshot && (
                <div className="flex justify-between">
                  <span>Date commande</span>
                  <span className="text-foreground font-medium">{fmtDate(data.commande_date_snapshot)}</span>
                </div>
              )}
            </div>

            {/* Lines */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Lignes ({data.lines.length})
              </h3>
              <div className="divide-y divide-border/60 border rounded-lg overflow-hidden">
                {displayLines.map((line) => (
                  <div key={line.id} className="flex items-center justify-between px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{displayProductName(line.product_name_snapshot)}</p>
                      {line.projection_error ? (
                        <p className="text-xs text-destructive">{line.projection_error}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {line.display_quantity} {line.display_unit_label} × {fmtEur(line.display_unit_price)}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-bold tabular-nums shrink-0 ml-3">
                      {fmtEur(line.line_total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Total */}
            <div className="flex items-center justify-between px-3 py-3 rounded-lg bg-primary/5 border border-primary/15">
              <span className="text-sm font-medium">Total HT</span>
              <span className="text-lg font-bold text-primary tabular-nums">
                {fmtEur(data.total_ht)}
              </span>
            </div>

            {data.status === "annulee" && (
              <div className="text-center py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium">
                Facture annulée
              </div>
            )}

            {/* Download PDF */}
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleDownloadPdf}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Télécharger PDF
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
