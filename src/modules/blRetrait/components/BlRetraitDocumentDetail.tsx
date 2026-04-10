/**
 * BL Retrait — Document Detail
 * Shows lines with frozen prices + professional PDF export.
 */

import { useState, useMemo } from "react";
import { ArrowLeft, Download, Loader2, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useBlRetraitLines } from "../hooks/useBlRetraitLines";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useVoidDocument } from "@/modules/stockLedger/hooks/useVoidDocument";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import type { BlRetraitDocument } from "../types";
import { BlRetraitCorrectionDialog } from "./BlRetraitCorrectionDialog";

interface Props {
  document: BlRetraitDocument;
  onBack: () => void;
}

export function BlRetraitDocumentDetail({ document: docProp, onBack }: Props) {
  // ── Fresh document source: re-fetched so corrections update total_eur ──
  const { data: freshDoc } = useQuery({
    queryKey: ["bl-retrait-doc-detail", docProp.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bl_withdrawal_documents")
        .select("*")
        .eq("id", docProp.id)
        .single();
      if (error) throw error;
      // Merge raw DB fields with resolved names from the parent list
      return {
        ...(data as unknown as Omit<BlRetraitDocument, "source_name" | "destination_name" | "direction">),
        source_name: docProp.source_name,
        destination_name: docProp.destination_name,
        direction: docProp.direction,
      } as BlRetraitDocument;
    },
  });
  const doc = freshDoc ?? docProp;

  const { data: lines = [], isLoading } = useBlRetraitLines(doc.id);
  const { voidDocument, isVoiding } = useVoidDocument();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);

  // Fetch unit abbreviations
  const unitIds = [...new Set(lines.map((l) => l.canonical_unit_id))];
  const { data: units = [] } = useQuery({
    queryKey: ["units-abbrev", unitIds.join(",")],
    queryFn: async () => {
      if (unitIds.length === 0) return [];
      const { data } = await supabase
        .from("measurement_units")
        .select("id, abbreviation")
        .in("id", unitIds);
      return data ?? [];
    },
    enabled: unitIds.length > 0,
  });
  const unitMap = new Map(units.map((u) => [u.id, u.abbreviation]));

  // Fetch source establishment (the one that withdrew)
  const { data: sourceEst } = useQuery({
    queryKey: ["establishment-detail", doc.establishment_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("establishments")
        .select("name, address, trade_name")
        .eq("id", doc.establishment_id)
        .single();
      return data;
    },
  });

  // Fetch destination establishment
  const { data: destEst } = useQuery({
    queryKey: ["establishment-detail", doc.destination_establishment_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("establishments")
        .select("name, address, trade_name")
        .eq("id", doc.destination_establishment_id)
        .single();
      return data;
    },
  });

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const voidResult = await voidDocument({
        documentId: doc.stock_document_id,
        voidReason: `Annulation BL ${doc.bl_number}`,
      });

      if (!voidResult.ok) {
        toast.error(`Échec de l'annulation du stock : ${voidResult.error}`);
        setIsDeleting(false);
        return;
      }

      await supabase
        .from("bl_withdrawal_lines")
        .delete()
        .eq("bl_withdrawal_document_id", doc.id);

      await supabase
        .from("bl_withdrawal_documents")
        .delete()
        .eq("id", doc.id);

      await queryClient.invalidateQueries({ queryKey: ["bl-retrait-documents"] });

      toast.success("Bon de sortie supprimé — stock restauré");
      onBack();
    } catch (err: any) {
      toast.error(err?.message ?? "Erreur inattendue");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownloadPdf = () => {
    const pdf = new jsPDF();
    const dateStr = new Date(doc.bl_date).toLocaleDateString("fr-FR");
    const pageWidth = pdf.internal.pageSize.getWidth();

    // ── Title ──
    pdf.setFontSize(22);
    pdf.setFont("helvetica", "bold");
    pdf.text("Bon de sortie", 14, 22);

    // BL number + date (right-aligned)
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "normal");
    pdf.text(`N° ${doc.bl_number}`, pageWidth - 14, 16, { align: "right" });
    pdf.text(`Date : ${dateStr}`, pageWidth - 14, 22, { align: "right" });

    // ── Separator ──
    pdf.setDrawColor(180);
    pdf.line(14, 28, pageWidth - 14, 28);

    // ── Source establishment (left) ──
    let y = 36;
    pdf.setFontSize(9);
    pdf.setTextColor(100);
    pdf.text("EXPÉDITEUR", 14, y);
    pdf.setTextColor(0);
    y += 6;
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.text(sourceEst?.trade_name || sourceEst?.name || "—", 14, y);
    y += 5;
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    if (sourceEst?.name && sourceEst?.trade_name) {
      pdf.text(sourceEst.name, 14, y);
      y += 4;
    }
    if (sourceEst?.address) {
      pdf.text(sourceEst.address, 14, y);
      y += 4;
    }

    // ── Destination establishment (right) ──
    let yDest = 36;
    const rightX = pageWidth / 2 + 10;
    pdf.setFontSize(9);
    pdf.setTextColor(100);
    pdf.text("DESTINATAIRE", rightX, yDest);
    pdf.setTextColor(0);
    yDest += 6;
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.text(destEst?.trade_name || destEst?.name || "—", rightX, yDest);
    yDest += 5;
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    if (destEst?.name && destEst?.trade_name) {
      pdf.text(destEst.name, rightX, yDest);
      yDest += 4;
    }
    if (destEst?.address) {
      pdf.text(destEst.address, rightX, yDest);
      yDest += 4;
    }

    // ── Table ──
    const tableStartY = Math.max(y, yDest) + 10;

    autoTable(pdf, {
      startY: tableStartY,
      head: [["#", "Produit", "Qté", "Unité", "Prix unit. (€)", "Total (€)"]],
      body: lines.map((l, i) => [
        String(i + 1),
        l.product_name_snapshot,
        String(l.quantity_canonical),
        unitMap.get(l.canonical_unit_id) ?? "—",
        l.unit_price_snapshot !== null ? l.unit_price_snapshot.toFixed(2) : "—",
        l.line_total_snapshot !== null ? l.line_total_snapshot.toFixed(2) : "—",
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

    // ── Total box ──
    const finalY = (pdf as any).lastAutoTable?.finalY ?? tableStartY + 30;
    pdf.setFillColor(240, 240, 240);
    pdf.roundedRect(pageWidth - 80, finalY + 5, 66, 14, 2, 2, "F");
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "bold");
    pdf.text("Total :", pageWidth - 76, finalY + 14);
    pdf.text(`${doc.total_eur.toFixed(2)} €`, pageWidth - 18, finalY + 14, { align: "right" });

    // ── Footer ──
    const footerY = pdf.internal.pageSize.getHeight() - 15;
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(140);
    pdf.text(`Généré le ${new Date().toLocaleDateString("fr-FR")}`, 14, footerY);
    pdf.text(doc.bl_number, pageWidth - 14, footerY, { align: "right" });

    pdf.save(`${doc.bl_number}.pdf`);
  };

  const busy = isVoiding || isDeleting;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-semibold">{doc.bl_number}</h2>
          <p className="text-sm text-muted-foreground">
            {destEst?.name ?? "—"} — {new Date(doc.bl_date).toLocaleDateString("fr-FR")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={isLoading || lines.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          PDF
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCorrectionOpen(true)} disabled={busy}>
          <Pencil className="h-4 w-4 mr-2" />
          Corriger
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Supprimer
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer {doc.bl_number} ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action annulera le retrait dans le stock (les quantités seront restaurées) et supprimera définitivement ce bon de sortie.
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

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produits retirés</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : lines.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">Aucune ligne</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium">Produit</th>
                    <th className="pb-2 font-medium text-right">Qté</th>
                    <th className="pb-2 font-medium text-right">Unité</th>
                    <th className="pb-2 font-medium text-right">Prix unit.</th>
                    <th className="pb-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-b last:border-0">
                      <td className="py-2">{line.product_name_snapshot}</td>
                      <td className="py-2 text-right font-mono">{line.quantity_canonical}</td>
                      <td className="py-2 text-right text-muted-foreground">
                        {unitMap.get(line.canonical_unit_id) ?? "—"}
                      </td>
                      <td className="py-2 text-right text-muted-foreground">
                        {line.unit_price_snapshot !== null
                          ? `${line.unit_price_snapshot.toFixed(2)} €`
                          : "—"}
                      </td>
                      <td className="py-2 text-right font-mono font-medium">
                        {line.line_total_snapshot !== null
                          ? `${line.line_total_snapshot.toFixed(2)} €`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2">
                    <td colSpan={4} className="py-3 text-right font-semibold">Total</td>
                    <td className="py-3 text-right font-mono font-bold text-base">
                      {doc.total_eur.toFixed(2)} €
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Action buttons inside the card, always visible after table */}
              <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t">
                <Button variant="outline" size="sm" onClick={() => setCorrectionOpen(true)} disabled={busy}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Corriger le bon de sortie
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                      Supprimer le bon de sortie
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Supprimer {doc.bl_number} ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Cette action annulera le retrait dans le stock (les quantités seront restaurées) et supprimera définitivement ce bon de sortie.
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Correction dialog */}
      <BlRetraitCorrectionDialog
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        blDocument={doc}
      />
    </div>
  );
}
