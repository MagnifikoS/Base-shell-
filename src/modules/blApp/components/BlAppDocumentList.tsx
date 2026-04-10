/**
 * MODULE BL-APP — Document List per Supplier (V1)
 * Shows total € per BL computed from frozen snapshot prices (SSOT).
 *
 * BL APP UX FIX:
 * - "Supprimer" button (Trash2): hard-deletes the BL document + lines/files ONLY.
 *   Does NOT touch stock_events. The stock ledger is the SSOT for stock reality.
 *   Deleting a "proof document" must never affect stock.
 * - "Annuler la réception" (VOID stock) remains in BlAppDocumentDetail view.
 */

import { useState } from "react";
import { ArrowLeft, FileText, Check, Clock, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import type { BlAppDocument } from "../types";
import { formatYearMonth, type MonthNavigation } from "@/modules/shared";
import { useBlAppDocumentTotals } from "../hooks/useBlAppDocumentTotals";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useVoidDocument } from "@/modules/stockLedger";

interface Props {
  documents: BlAppDocument[];
  supplierName: string;
  month: MonthNavigation;
  onBack: () => void;
  onSelectDocument: (docId: string) => void;
}

export function BlAppDocumentList({
  documents,
  supplierName,
  month,
  onBack,
  onSelectDocument,
}: Props) {
  const monthLabel = formatYearMonth(month.year, month.month);
  const queryClient = useQueryClient();

  const { data: docsWithTotals } = useBlAppDocumentTotals(documents);
  const [deleteTargetDoc, setDeleteTargetDoc] = useState<BlAppDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { voidDocument } = useVoidDocument();

  // Compute grand total across all docs
  const grandTotal = docsWithTotals?.reduce((sum, d) => sum + (d.total_value ?? 0), 0) ?? 0;
  const hasAnyTotal = docsWithTotals?.some((d) => d.total_value !== null) ?? false;
  const grandTotalDisplay = hasAnyTotal ? `${grandTotal.toFixed(2)} €` : "—";

  // Map for quick lookup
  const totalMap = new Map((docsWithTotals ?? []).map((d) => [d.id, d]));

  /**
   * Supprimer un BL : 
   * 1. Si le stock_document est POSTED → VOID automatique (annule les quantités du ledger)
   * 2. Supprime le document BL et ses lignes/fichiers
   */
  const handleDeleteBl = async (doc: BlAppDocument) => {
    setIsDeleting(true);
    try {
      // 1. Vérifier l'état du stock_document lié
      if (doc.stock_document_id) {
        const { data: stockDoc } = await supabase
          .from("stock_documents")
          .select("id, status")
          .eq("id", doc.stock_document_id)
          .maybeSingle();

        // Si POSTED → VOID obligatoire pour annuler les quantités du ledger
        if (stockDoc?.status === "POSTED") {
          const voidResult = await voidDocument({
            documentId: doc.stock_document_id,
            voidReason: "Suppression du BL par l'utilisateur",
          });
          if (!voidResult.ok) {
            throw new Error(
              voidResult.error === "VOID_ACCESS_DENIED"
                ? "Droits insuffisants pour annuler le mouvement de stock."
                : `Erreur annulation stock : ${voidResult.error}`
            );
          }
        }
      }

      // 2. Supprimer fichiers, lignes et document BL
      await supabase.from("bl_app_files").delete().eq("bl_app_document_id", doc.id);
      await supabase.from("bl_app_lines").delete().eq("bl_app_document_id", doc.id);
      const { error } = await supabase.from("bl_app_documents").delete().eq("id", doc.id);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["bl-app-documents"] });
      queryClient.invalidateQueries({ queryKey: ["bl-app-by-stock-doc"] });
      queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
      toast.success("BL supprimé et mouvement de stock annulé ✓");
      setDeleteTargetDoc(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur inattendue";
      toast.error(`Erreur suppression : ${msg}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-xl font-semibold">{supplierName}</h2>
          <p className="text-sm text-muted-foreground capitalize">{monthLabel}</p>
        </div>
      </div>

      {/* Summary */}
      <div className="p-4 bg-muted rounded-lg flex items-center justify-between">
        <span className="text-muted-foreground">
          {documents.length} BL{documents.length > 1 ? "s" : ""}
        </span>
        <span className="text-sm font-semibold">{grandTotalDisplay}</span>
      </div>

      {/* List */}
      {documents.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Aucun BL-APP</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => {
            const enriched = totalMap.get(doc.id);
            const hasBlNumber = !!doc.bl_number && doc.bl_number !== "BL-MANQUANT";
            const hasFile = !!doc.has_files;
            const isComplete = hasBlNumber && hasFile;
            return (
              <Card
                key={doc.id}
                className="transition-colors hover:bg-accent/50"
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div
                    className="flex items-center gap-3 flex-1 cursor-pointer"
                    onClick={() => onSelectDocument(doc.id)}
                  >
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">
                          {doc.bl_number || "BL manquant"}
                        </p>
                        <span className="text-sm font-mono font-medium text-muted-foreground">
                          {enriched?.total_display ?? "—"}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {new Date(doc.bl_date).toLocaleDateString("fr-FR")}
                        {doc.created_at && (
                          <span className="ml-1">
                            à {new Date(doc.created_at).toLocaleTimeString("fr-FR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                        {doc.created_by_name && (
                          <span className="ml-1">
                            — {doc.created_by_name}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <Badge variant={isComplete ? "default" : "secondary"} className="gap-1">
                      {isComplete ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                      {isComplete ? "Complet" : "À compléter"}
                    </Badge>

                    {/* Supprimer le BL (document uniquement, sans VOID stock) */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      title="Supprimer ce BL (document uniquement, stock non modifié)"
                      aria-label="Supprimer le BL"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTargetDoc(doc);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Confirmation suppression BL (hard delete, sans VOID stock) */}
      <AlertDialog
        open={!!deleteTargetDoc}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetDoc(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Supprimer ce BL ?
            </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    <p>
                      Le bon de livraison{" "}
                      <strong>{deleteTargetDoc?.bl_number || "sans numéro"}</strong> sera
                      supprimé définitivement.
                    </p>
                    <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-sm space-y-1">
                      <p className="font-medium text-destructive">⚠️ Impact sur le stock :</p>
                      <p>
                        Si la réception a déjà été validée dans le ledger, les quantités seront
                        automatiquement <strong>retirées du stock</strong> (mouvement inverse).
                      </p>
                    </div>
                  </div>
                </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTargetDoc && handleDeleteBl(deleteTargetDoc)}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              Supprimer le BL
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
