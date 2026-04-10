/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURES — Invoice List Component V3.1 (Pagination + Imports Fixed)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Liste des factures d'un fournisseur pour un mois.
 * Actions: Voir, Télécharger, Supprimer (double confirmation), Paiement.
 *
 * ⚠️ SÉCURITÉ:
 * - La suppression utilise InvoiceDeleteDialog (2 étapes)
 * - Voir docs/data-deletion-policy.md
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useRef } from "react";
import { Eye, Download, CreditCard, FileText, Trash2, Pencil, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { Badge } from "@/components/ui/badge";
import { usePagination } from "@/hooks/usePagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { toast } from "sonner";
import type { Invoice } from "../types";
import { downloadInvoiceFile, deleteInvoice } from "../services/invoiceService";

import { InvoicePreview } from "./InvoicePreview";
import { InvoiceDeleteDialog } from "./InvoiceDeleteDialog";
import { logInvoiceVoided } from "@/modules/theBrain";

interface InvoiceListProps {
  invoices: Invoice[];
  isLoading?: boolean;
  onInvoiceDeleted?: () => void;
}

export function InvoiceList({ invoices, isLoading, onInvoiceDeleted }: InvoiceListProps) {
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Pagination (PERF-08)
  const {
    paginatedData: paginatedInvoices,
    currentPage,
    totalPages,
    totalItems,
    hasNextPage,
    hasPrevPage,
    nextPage,
    prevPage,
    goToPage,
  } = usePagination(invoices, { pageSize: 25 });

  const startEditNumber = (invoice: Invoice) => {
    setEditingId(invoice.id);
    setEditValue(invoice.invoice_number || "");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const saveEditNumber = async () => {
    if (!editingId) return;
    const trimmed = editValue.trim();
    const { error } = await supabase
      .from("invoices")
      .update({ invoice_number: trimmed || null })
      .eq("id", editingId);
    if (error) {
      toast.error("Erreur lors de la mise à jour");
    } else {
      toast.success("Numéro de facture mis à jour");
      onInvoiceDeleted?.(); // reuse refetch callback
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const handleDownload = async (invoice: Invoice) => {
    if (!invoice.file_path) {
      toast.error("Facture non disponible — fichier manquant");
      return;
    }

    setDownloading(invoice.id);
    try {
      // Skip if file path missing
      if (!invoice.file_path) {
        toast.error("Fichier de facture manquant");
        return;
      }

      const url = await downloadInvoiceFile(invoice.file_path);
      if (url) {
        const link = document.createElement("a");
        link.href = url;
        link.download = invoice.file_name || `facture-${invoice.invoice_number || invoice.id}.pdf`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("PDF téléchargé avec succès");
      } else {
        toast.error("Erreur lors du téléchargement de la facture");
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error("[InvoiceList] download error:", error);
      toast.error("Erreur lors du téléchargement de la facture");
    } finally {
      setDownloading(null);
    }
  };

  const handlePaymentClick = () => {
    toast.info("Fonctionnalité de paiement à venir");
  };

  /**
   * Handler de suppression - appelé UNIQUEMENT après double confirmation
   * via InvoiceDeleteDialog
   */
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) {
      if (import.meta.env.DEV)
        console.error("[InvoiceList] handleDeleteConfirm called but no deleteTarget");
      return;
    }

    if (import.meta.env.DEV)
      // eslint-disable-next-line no-console
      console.log("[InvoiceList] Starting delete for invoice:", deleteTarget.id);

    try {
      const result = await deleteInvoice(deleteTarget.id, deleteTarget.file_path);
      // eslint-disable-next-line no-console
      if (import.meta.env.DEV) console.log("[InvoiceList] Delete result:", result);

      if (result.success) {
        // THE BRAIN: Log invoice voided (fire-and-forget)
        logInvoiceVoided(deleteTarget.establishment_id, deleteTarget.id);

        toast.success("Facture supprimée définitivement");
        setDeleteTarget(null); // Clear target after successful delete
        onInvoiceDeleted?.();
      } else {
        toast.error(result.error || "Erreur lors de la suppression");
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error("[InvoiceList] delete error:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <TableSkeleton rows={5} columns={4} />
        </CardContent>
      </Card>
    );
  }

  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <EmptyState
            icon={<FileText className="h-12 w-12" />}
            title="Aucune facture"
            description="Aucune facture pour ce fournisseur ce mois."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <Table aria-label="Liste des factures">
            <TableHeader>
              <TableRow>
                <TableHead>Référence</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedInvoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">
                    {editingId === invoice.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          ref={inputRef}
                          className="h-7 w-28 rounded border border-input bg-background px-2 text-sm"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditNumber();
                            if (e.key === "Escape") cancelEdit();
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={saveEditNumber}
                          aria-label="Valider"
                        >
                          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={cancelEdit}
                          aria-label="Annuler"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span
                        className="cursor-pointer hover:underline inline-flex items-center gap-1 group"
                        onClick={() => startEditNumber(invoice)}
                        title="Cliquer pour modifier"
                      >
                        {invoice.invoice_number || "—"}
                        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">Standard</span>
                  </TableCell>
                  <TableCell>
                    {new Date(invoice.invoice_date).toLocaleDateString("fr-FR")}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {invoice.amount_eur.toLocaleString("fr-FR", {
                      style: "currency",
                      currency: "EUR",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (!invoice.file_path) {
                            toast.error("Facture non disponible — fichier manquant");
                            return;
                          }
                          setPreviewInvoice(invoice);
                        }}
                        title="Apercu"
                        aria-label="Apercu de la facture"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownload(invoice)}
                        disabled={downloading === invoice.id}
                        title="Telecharger"
                        aria-label="Telecharger la facture"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(invoice)}
                        title="Supprimer"
                        aria-label="Supprimer la facture"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handlePaymentClick}
                        title="Paiement"
                        aria-label="Paiement de la facture"
                        className="text-muted-foreground"
                      >
                        <CreditCard className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        {/* Pagination (PERF-08) */}
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          hasNextPage={hasNextPage}
          hasPrevPage={hasPrevPage}
          onNextPage={nextPage}
          onPrevPage={prevPage}
          onGoToPage={goToPage}
        />
      </Card>

      {previewInvoice && (
        <InvoicePreview invoice={previewInvoice} onClose={() => setPreviewInvoice(null)} />
      )}

      {/* Dialog de suppression avec DOUBLE CONFIRMATION */}
      <InvoiceDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        invoice={deleteTarget}
        onDelete={handleDeleteConfirm}
      />
    </>
  );
}
