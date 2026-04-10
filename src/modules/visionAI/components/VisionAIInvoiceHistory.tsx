/**
 * Vision AI — Invoice History
 *
 * Shows recent invoices saved through Vision AI for the current establishment.
 * Allows viewing PDF and deleting invoices with 2-step confirmation.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { deleteInvoice, downloadInvoiceFile, InvoiceDeleteDialog } from "@/modules/factures";
import type { Invoice } from "@/modules/factures";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Download,
  Trash2,
  Eye,
  Loader2,
  History,
} from "lucide-react";
import { toast } from "sonner";
import { logInvoiceVoided } from "@/modules/theBrain";

const RECENT_LIMIT = 20;

/* ── Doc-type badge config (mirrors ScanHistoryRow) ── */

type DocType = "facture" | "bl" | "releve";

const DOC_TYPE_BADGE: Record<DocType, { label: string; className: string }> = {
  facture: {
    label: "Facture",
    className: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  },
  bl: {
    label: "BL",
    className: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
  },
  releve: {
    label: "Relevé",
    className: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
  },
};

/** Infer document type from invoice number and file name */
function inferDocType(invoice: { invoice_number: string | null; file_name: string }): DocType {
  const num = (invoice.invoice_number ?? "").toUpperCase();
  const name = (invoice.file_name ?? "").toUpperCase();

  if (num.includes("BL") || name.includes("BL")) return "bl";
  if (
    num.includes("RLV") ||
    num.includes("RELEV") ||
    name.includes("RLV") ||
    name.includes("RELEV")
  )
    return "releve";
  return "facture";
}

interface VisionAIInvoiceHistoryProps {
  className?: string;
}

export function VisionAIInvoiceHistory({ className }: VisionAIInvoiceHistoryProps) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;
  const queryClient = useQueryClient();

  const [expanded, setExpanded] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["vision-ai-history", establishmentId],
    queryFn: async (): Promise<Invoice[]> => {
      if (!establishmentId) return [];

      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id, establishment_id, organization_id, supplier_id, supplier_name, supplier_name_normalized, invoice_number, invoice_date, amount_eur, file_path, file_name, file_size, file_type, is_paid, created_by, created_at, updated_at"
        )
        .eq("establishment_id", establishmentId)
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT);

      if (error) {
        if (import.meta.env.DEV) console.error("[VisionAIHistory] error:", error);
        throw error;
      }

      return (data || []) as Invoice[];
    },
    enabled: !!establishmentId,
  });

  const handlePreview = async (invoice: Invoice) => {
    setLoadingPreviewId(invoice.id);
    try {
      const url = await downloadInvoiceFile(invoice.file_path);
      if (url) {
        window.open(url, "_blank");
      } else {
        toast.error("Impossible d'ouvrir le fichier");
      }
    } catch {
      toast.error("Erreur lors de l'ouverture du fichier");
    } finally {
      setLoadingPreviewId(null);
    }
  };

  const handleDownload = async (invoice: Invoice) => {
    try {
      const url = await downloadInvoiceFile(invoice.file_path);
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = invoice.file_name || "facture.pdf";
        a.click();
      } else {
        toast.error("Impossible de télécharger le fichier");
      }
    } catch {
      toast.error("Erreur lors du téléchargement");
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    const result = await deleteInvoice(deleteTarget.id, deleteTarget.file_path);
    if (result.success) {
      toast.success("Document supprimé");
      // Log to The Brain (fire-and-forget)
      if (establishmentId) {
        logInvoiceVoided(establishmentId, deleteTarget.id);
      }
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["vision-ai-history"] });
      queryClient.invalidateQueries({ queryKey: ["factures"] });
    } else {
      toast.error("Erreur lors de la suppression", {
        description: result.error,
      });
    }
  };

  if (!establishmentId || invoices.length === 0) return null;

  return (
    <div className={className}>
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-3 px-4 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Extractions récentes</span>
          <span className="text-muted-foreground">({invoices.length})</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Invoice list */}
      {expanded && (
        <div className="mt-2 space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            invoices.map((invoice) => (
              <InvoiceRow
                key={invoice.id}
                invoice={invoice}
                onPreview={() => handlePreview(invoice)}
                onDownload={() => handleDownload(invoice)}
                onDelete={() => setDeleteTarget(invoice)}
                isLoadingPreview={loadingPreviewId === invoice.id}
              />
            ))
          )}
        </div>
      )}

      {/* Delete dialog */}
      <InvoiceDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        invoice={deleteTarget}
        onDelete={handleDeleteConfirm}
      />
    </div>
  );
}

interface InvoiceRowProps {
  invoice: Invoice;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
  isLoadingPreview: boolean;
}

function InvoiceRow({
  invoice,
  onPreview,
  onDownload,
  onDelete,
  isLoadingPreview,
}: InvoiceRowProps) {
  const formattedDate = new Date(invoice.invoice_date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const formattedAmount = invoice.amount_eur.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
  });

  const docType = inferDocType(invoice);
  const badge = DOC_TYPE_BADGE[docType];

  return (
    <div className="flex items-center justify-between px-4 py-2.5 rounded-lg hover:bg-muted/30 transition-colors group">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {invoice.invoice_number || "Sans numéro"}
            </span>
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${badge.className}`}
            >
              {badge.label}
            </span>
            <span className="text-xs text-muted-foreground">{invoice.supplier_name || "—"}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formattedDate}</span>
            <span className="font-medium text-foreground">{formattedAmount}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onPreview}
          disabled={isLoadingPreview}
          aria-label="Voir le PDF"
        >
          {isLoadingPreview ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onDownload}
          aria-label="Télécharger"
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label="Supprimer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
