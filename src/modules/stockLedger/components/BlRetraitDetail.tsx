/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BL RETRAIT DETAIL — Detail view for a single BL Retrait
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shows: BL number, date, destination, lines table with totals.
 * Actions: PDF download, Corriger, Supprimer.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { ArrowLeft, Download, Pencil, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useVoidDocument } from "../hooks/useVoidDocument";
import { toast } from "sonner";
import type { BlRetraitWithLines } from "../hooks/useBlRetraits";
import { BlRetraitCorrectionDialog } from "@/modules/blRetrait/components/BlRetraitCorrectionDialog";

interface BlRetraitDetailProps {
  blRetrait: BlRetraitWithLines;
  onBack: () => void;
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return "-";
  const formatted = amount.toFixed(2).replace(".", ",");
  const parts = formatted.split(",");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${parts.join(",")} €`;
}

export function BlRetraitDetail({ blRetrait, onBack }: BlRetraitDetailProps) {
  const { voidDocument, isVoiding } = useVoidDocument();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);

  const busy = isVoiding || isDeleting;

  // Build a compatible doc object for the correction dialog
  const correctionDoc = {
    id: blRetrait.id,
    establishment_id: blRetrait.establishment_id,
    organization_id: blRetrait.organization_id,
    stock_document_id: blRetrait.stock_document_id,
    bl_number: blRetrait.bl_number,
    bl_date: blRetrait.created_at.split("T")[0],
    destination_establishment_id: blRetrait.destination_establishment_id ?? "",
    destination_name: blRetrait.destination_name ?? null,
    source_name: null,
    direction: "sent" as const,
    total_eur: blRetrait.total_amount ?? 0,
    created_by: blRetrait.created_by ?? null,
    created_at: blRetrait.created_at,
    created_by_name: null,
    stock_status: (blRetrait.isDraft ? "DRAFT" : "POSTED") as "DRAFT" | "POSTED",
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const voidResult = await voidDocument({
        documentId: blRetrait.stock_document_id,
        voidReason: `Annulation BL ${blRetrait.bl_number}`,
      });

      if (!voidResult.ok) {
        toast.error(`Échec de l'annulation du stock : ${voidResult.error}`);
        setIsDeleting(false);
        return;
      }

      await supabase
        .from("bl_withdrawal_lines")
        .delete()
        .eq("bl_withdrawal_document_id", blRetrait.id);

      await supabase
        .from("bl_withdrawal_documents")
        .delete()
        .eq("id", blRetrait.id);

      await queryClient.invalidateQueries({ queryKey: ["bl-retraits"] });

      toast.success("Bon de livraison supprimé — stock restauré");
      onBack();
    } catch (err: any) {
      toast.error(err?.message ?? "Erreur inattendue");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownloadPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const pdf = new jsPDF();
    const dateStr = formatDate(blRetrait.created_at);
    const pageWidth = pdf.internal.pageSize.getWidth();

    pdf.setFontSize(22);
    pdf.setFont("helvetica", "bold");
    pdf.text("Bon de Livraison", 14, 22);

    pdf.setFontSize(11);
    pdf.setFont("helvetica", "normal");
    pdf.text(`N° ${blRetrait.bl_number}`, pageWidth - 14, 16, { align: "right" });
    pdf.text(`Date : ${dateStr}`, pageWidth - 14, 22, { align: "right" });

    pdf.setDrawColor(180);
    pdf.line(14, 28, pageWidth - 14, 28);

    let y = 36;
    if (blRetrait.destination_name) {
      pdf.setFontSize(9);
      pdf.setTextColor(100);
      pdf.text("DESTINATAIRE", 14, y);
      pdf.setTextColor(0);
      y += 6;
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "bold");
      pdf.text(blRetrait.destination_name, 14, y);
      y += 8;
    }

    autoTable(pdf, {
      startY: y + 4,
      head: [["#", "Produit", "Qté", "Unité", "Prix unit. (€)", "Total (€)"]],
      body: blRetrait.lines.map((l, i) => [
        String(i + 1),
        l.product_name_snapshot,
        String(l.quantity),
        l.unit_label ?? "—",
        l.unit_price != null ? l.unit_price.toFixed(2) : "—",
        l.line_total != null ? l.line_total.toFixed(2) : "—",
      ]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [40, 40, 40], textColor: [255, 255, 255], fontStyle: "bold" },
      columnStyles: {
        0: { halign: "center", cellWidth: 12 },
        2: { halign: "right" },
        3: { halign: "center" },
        4: { halign: "right" },
        5: { halign: "right" },
      },
      alternateRowStyles: { fillColor: [248, 248, 248] },
    });

    const finalY = (pdf as any).lastAutoTable?.finalY ?? y + 40;
    pdf.setFillColor(240, 240, 240);
    pdf.roundedRect(pageWidth - 80, finalY + 5, 66, 14, 2, 2, "F");
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "bold");
    pdf.text("Total :", pageWidth - 76, finalY + 14);
    pdf.text(`${formatCurrency(blRetrait.total_amount)}`, pageWidth - 18, finalY + 14, { align: "right" });

    const footerY = pdf.internal.pageSize.getHeight() - 15;
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(140);
    pdf.text(`Généré le ${new Date().toLocaleDateString("fr-FR")}`, 14, footerY);
    pdf.text(blRetrait.bl_number, pageWidth - 14, footerY, { align: "right" });

    pdf.save(`${blRetrait.bl_number}.pdf`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold">{blRetrait.bl_number}</h2>
          <p className="text-sm text-muted-foreground">{formatDate(blRetrait.created_at)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={blRetrait.lines.length === 0} className="gap-1">
          <Download className="h-4 w-4" />
          PDF
        </Button>
        <Badge variant={blRetrait.isDraft ? "outline" : "secondary"}>
          {blRetrait.isDraft ? "En transit" : "FINAL"}
        </Badge>
      </div>

      {/* Info card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Informations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Numéro BL</span>
            <span className="font-medium">{blRetrait.bl_number}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Date</span>
            <span>{formatDate(blRetrait.created_at)}</span>
          </div>
          {blRetrait.destination_name && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Destination</span>
              <span>{blRetrait.destination_name}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold">{formatCurrency(blRetrait.total_amount)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Lines table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lignes ({blRetrait.lines.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produit</TableHead>
                <TableHead className="text-right">Quantité</TableHead>
                <TableHead className="text-right">Prix unit.</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blRetrait.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-medium">{line.product_name_snapshot}</TableCell>
                  <TableCell className="text-right">
                    {line.quantity}
                    {line.unit_label ? ` ${line.unit_label}` : ""}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(line.unit_price)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(line.line_total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Total footer */}
          <div className="flex justify-between items-center px-4 py-3 border-t bg-muted/50">
            <span className="font-semibold text-sm">Total</span>
            <span className="font-bold">{formatCurrency(blRetrait.total_amount)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Action buttons — Corriger & Supprimer (only for POSTED, not DRAFT/in-transit) */}
      {!blRetrait.isDraft && (
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" size="sm" onClick={() => setCorrectionOpen(true)} disabled={busy} className="gap-2">
            <Pencil className="h-4 w-4" />
            Corriger le BL
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={busy} className="gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Supprimer le BL
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer {blRetrait.bl_number} ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Cette action annulera le retrait dans le stock (les quantités seront restaurées) et supprimera définitivement ce bon de livraison.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} disabled={busy}>
                  {busy ? "Suppression…" : "Confirmer la suppression"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      {blRetrait.isDraft && (
        <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground text-center">
          Ce BL est en transit — annulez l'expédition depuis la commande pour le supprimer.
        </div>
      )}

      {/* Correction dialog */}
      <BlRetraitCorrectionDialog
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        blDocument={correctionDoc}
      />
    </div>
  );
}