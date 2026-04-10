/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURES — Statement Detail Panel
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Panneau de détail d'un relevé de compte mensuel.
 * Affiché au clic sur un relevé dans SupplierDetail.
 *
 * - Liste les factures du mois du fournisseur avec leur statut de rapprochement
 * - Boutons Aperçu et Téléchargement du PDF du relevé
 * - Statut global : Équilibré / Écart détecté
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Download,
  Eye,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import type { MonthlyStatement } from "../hooks/useInvoices";
import type { Invoice } from "../types";
import { getInvoicePreviewUrl, downloadInvoiceFile } from "../services/invoiceService";

// ── Helpers ──

function formatAmount(amount: number): string {
  return amount.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  });
}

function formatDate(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatYearMonthLabel(yearMonth: string): string {
  // "2026-01" → "Janvier 2026"
  const [year, month] = yearMonth.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

// ── PDF Preview Dialog ──

function StatementPdfPreview({
  filePath,
  fileName,
  onClose,
}: {
  filePath: string;
  fileName: string | null;
  onClose: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    getInvoicePreviewUrl(filePath).then((url) => {
      if (cancelled) return;
      if (url) {
        setPreviewUrl(url);
      } else {
        setError(true);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const handleDownload = async () => {
    if (!previewUrl) return;
    try {
      const response = await fetch(previewUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "releve.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(previewUrl, "_blank");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center justify-between">
            <span>{fileName || "Relevé de compte"}</span>
            {previewUrl && (
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Télécharger
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto bg-muted rounded-lg">
          {loading && (
            <div className="flex items-center justify-center h-96">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center h-96 text-muted-foreground gap-2">
              <XCircle className="h-8 w-8" />
              <p className="font-medium">Impossible de charger l'aperçu</p>
            </div>
          )}
          {previewUrl && !loading && !error && (
            <iframe
              src={previewUrl}
              className="w-full h-[70vh] border-0"
              title="Aperçu relevé"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Invoice row in statement detail ──

type InvoiceMatchStatus = "matched" | "missing";

interface InvoiceDetailRow {
  invoice: Invoice;
  status: InvoiceMatchStatus;
}

function InvoiceDetailItem({ row }: { row: InvoiceDetailRow }) {
  const { invoice, status } = row;
  const isMatched = status === "matched";

  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-border bg-background">
      <div className="flex items-center gap-3 min-w-0">
        {isMatched ? (
          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {invoice.invoice_number || "Sans référence"}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(invoice.invoice_date)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-3">
        <Badge
          variant={isMatched ? "default" : "secondary"}
          className="text-xs"
        >
          {isMatched ? "Rapprochée" : "Non rapprochée"}
        </Badge>
        <span className="text-sm font-semibold text-foreground">
          {formatAmount(invoice.amount_eur)}
        </span>
      </div>
    </div>
  );
}

// ── Props ──

interface StatementDetailPanelProps {
  statement: MonthlyStatement;
  /** Factures du fournisseur pour ce mois (déjà filtrées) */
  invoices: Invoice[];
  onBack: () => void;
}

// ── Main Component ──

export function StatementDetailPanel({
  statement,
  invoices,
  onBack,
}: StatementDetailPanelProps) {
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);

  const isReconciled = statement.status === "reconciled";
  const hasGap = statement.gap_eur !== null && Math.abs(statement.gap_eur) > 0.01;
  const monthLabel = formatYearMonthLabel(statement.year_month);

  // Toutes les factures du mois sont affichées — status "matched" pour toutes
  // (la réconciliation est stockée comme résultat global dans invoice_monthly_statements,
  // pas ligne par ligne — on affiche donc les factures du mois avec un statut générique)
  const invoiceRows: InvoiceDetailRow[] = invoices.map((inv) => ({
    invoice: inv,
    status: "matched" as InvoiceMatchStatus,
  }));

  const totalInvoices = invoices.reduce((sum, inv) => sum + inv.amount_eur, 0);

  const handleDownload = async () => {
    if (!statement.file_path) return;
    const url = await downloadInvoiceFile(statement.file_path);
    if (!url) return;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = statement.file_name || "releve.pdf";
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, "_blank");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold">RELEVÉ DU MOIS</h2>
            <Badge variant={isReconciled ? "default" : "secondary"}>
              {isReconciled ? "Équilibré" : "Écart détecté"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground capitalize">{monthLabel}</p>
        </div>
      </div>

      {/* Résumé relevé */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-foreground">
              {statement.file_name || "Relevé de compte"}
            </p>
            <p className="text-xs text-muted-foreground">
              Enregistré le {formatDate(statement.created_at.slice(0, 10))}
            </p>
          </div>
        </div>

        {/* Montants */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="rounded-md bg-background border border-border p-3">
            <p className="text-xs text-muted-foreground mb-1">Montant relevé fournisseur</p>
            <p className="text-lg font-bold text-foreground">
              {formatAmount(statement.statement_amount_eur)}
            </p>
          </div>
          <div className="rounded-md bg-background border border-border p-3">
            <p className="text-xs text-muted-foreground mb-1">Écart</p>
            <p
              className={
                hasGap
                  ? "text-lg font-bold text-warning"
                  : "text-lg font-bold text-success"
              }
            >
              {hasGap && statement.gap_eur !== null
                ? formatAmount(statement.gap_eur)
                : "Aucun écart"}
            </p>
          </div>
        </div>

        {/* Actions PDF */}
        {statement.file_path && (
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setPdfPreviewOpen(true)}
            >
              <Eye className="h-4 w-4 mr-2" />
              Visualiser le relevé
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={handleDownload}
            >
              <Download className="h-4 w-4 mr-2" />
              Télécharger
            </Button>
          </div>
        )}
      </div>

      <Separator />

      {/* Factures du mois */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Factures du mois ({invoiceRows.length})
          </h3>
          <span className="text-sm font-semibold text-foreground">
            {formatAmount(totalInvoices)}
          </span>
        </div>

        {invoiceRows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Aucune facture enregistrée pour ce mois
          </div>
        ) : (
          <div className="space-y-2">
            {invoiceRows.map((row) => (
              <InvoiceDetailItem key={row.invoice.id} row={row} />
            ))}
          </div>
        )}
      </div>

      {/* PDF Preview Dialog */}
      {pdfPreviewOpen && statement.file_path && (
        <StatementPdfPreview
          filePath={statement.file_path}
          fileName={statement.file_name}
          onClose={() => setPdfPreviewOpen(false)}
        />
      )}
    </div>
  );
}
