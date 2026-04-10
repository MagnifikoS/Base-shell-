/**
 * MODULE BL-APP — Document Detail (V2)
 * Shows EFFECTIVE lines (original + corrections merged).
 * New products added via corrections appear in the table.
 * Total reflects the effective view.
 */

import { useState, useRef, useMemo } from "react";
import {
  ArrowLeft,
  Check,
  Clock,
  FileText,
  Download,
  Eye,
  Loader2,
  Camera,
  Image,
  Wrench,
  Ban,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { useBlAppLinesWithPrices } from "../hooks/useBlAppLinesWithPrices";
import { useBlAppFiles } from "../hooks/useBlAppFiles";
import { useCompleteBlApp } from "../hooks/useCompleteBlApp";
import { useUploadBlAppFile } from "../hooks/useUploadBlAppFile";
import { useBlAppCorrections } from "../hooks/useBlAppCorrections";
import { useCumulativeCorrectionDeltas } from "../hooks/useCumulativeCorrectionDeltas";
import { useVoidBlApp } from "../hooks/useVoidBlApp";
import { useVoidDocument } from "@/modules/stockLedger";
import { getBlAppFileSignedUrl } from "../services/blAppService";
import { BlAppCorrectionDialog } from "./BlAppCorrectionDialog";
import type { BlAppDocument } from "../types";
import { displayProductName } from "@/utils/displayName";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  document: BlAppDocument;
  onBack: () => void;
}

export function BlAppDocumentDetail({ document: doc, onBack }: Props) {
  const { data: linesData, isLoading: linesLoading } = useBlAppLinesWithPrices(doc.id);
  const {
    data: files = [],
    isLoading: filesLoading,
    refetch: refetchFiles,
  } = useBlAppFiles(doc.id);
  const { data: corrections = [], isLoading: _correctionsLoading } = useBlAppCorrections(
    doc.stock_document_id
  );
  const completeBlApp = useCompleteBlApp();
  const uploadFile = useUploadBlAppFile();
  const { voidDocument, isVoiding } = useVoidDocument();
  const voidBlApp = useVoidBlApp();

  // Fetch stock_document metadata for correction dialog
  const { data: stockDocMeta } = useQuery({
    queryKey: ["stock-doc-meta", doc.stock_document_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_documents")
        .select("establishment_id, organization_id, storage_zone_id, supplier_id")
        .eq("id", doc.stock_document_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!doc.stock_document_id,
  });

  // ─── Cumulative correction deltas (shared hook) ───────────────
  const originalLines = linesData?.lines ?? [];

  const blOriginalProductIds = useMemo(
    () => new Set(originalLines.map((l) => l.product_id)),
    [originalLines]
  );
  const blOriginalQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of originalLines) map[l.product_id] = l.quantity;
    return map;
  }, [originalLines]);

  const hasPostedCorrections = corrections.some((c) => c.status === "POSTED");

  const { data: correctionData } = useCumulativeCorrectionDeltas(
    doc.stock_document_id,
    blOriginalProductIds,
    blOriginalQuantities,
    hasPostedCorrections
  );

  const cumulativeDeltas = correctionData?.deltaMap ?? {};
  const newCorrectionLines = correctionData?.newProductLines ?? [];

  // ─── Build effective lines: original (adjusted) + new correction lines ─
  const effectiveLines = useMemo(() => {
    // Original lines with corrected quantities
    const adjusted = originalLines.map((line) => {
      const delta = cumulativeDeltas[line.product_id] ?? 0;
      const effectiveQty = Math.round((line.quantity + delta) * 10000) / 10000;
      const hasDelta = Math.abs(delta) > 0.0001;
      return {
        ...line,
        original_quantity: line.quantity,
        quantity: effectiveQty,
        has_correction: hasDelta,
        delta,
      };
    });

    // New products added via corrections
    const newLines: typeof adjusted = newCorrectionLines.map((nl) => {
      const upVal = nl.unit_price ?? null;
      const ltVal = upVal != null ? Math.round(nl.effective_quantity * upVal * 100) / 100 : null;
      const upDisp = upVal != null ? `${upVal.toFixed(2)} €/${nl.unit_label}` : "—";
      const ltDisp = ltVal != null ? `${ltVal.toFixed(2)} €` : "—";
      return {
        id: `correction-${nl.product_id}`,
        product_id: nl.product_id,
        product_name: nl.product_name,
        quantity: nl.effective_quantity,
        unit_label: nl.unit_label,
        canonical_unit_id: nl.canonical_unit_id,
        unit_price_value: upVal,
        unit_price_display: upDisp,
        line_total_value: ltVal,
        line_total_display: ltDisp,
        // Correction lines: no billing projection (stay canonical)
        billing_quantity: nl.effective_quantity,
        billing_unit_label: nl.unit_label,
        billing_unit_price_value: upVal,
        billing_unit_price_display: upDisp,
        billing_line_total_display: ltDisp,
        has_billing_projection: false,
        projection_error: null,
        original_quantity: 0,
        has_correction: true,
        delta: nl.effective_quantity,
      };
    });

    return [...adjusted, ...newLines];
  }, [originalLines, cumulativeDeltas, newCorrectionLines]);

  // Effective total: original total + correction impact
  // For new products without prices, we can't compute — keep original total approach
  const effectiveTotalDisplay = useMemo(() => {
    let total = 0;
    let hasAny = false;
    for (const line of effectiveLines) {
      if (line.unit_price_value !== null) {
        total += line.quantity * line.unit_price_value;
        hasAny = true;
      } else if (line.line_total_value !== null && !line.has_correction) {
        // Uncorrected line with frozen total
        total += line.line_total_value;
        hasAny = true;
      }
    }
    return hasAny ? `${(Math.round(total * 100) / 100).toFixed(2)} €` : (linesData?.document_total_display ?? "—");
  }, [effectiveLines, linesData?.document_total_display]);

  const [blNumber, setBlNumber] = useState(doc.bl_number ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [previewMime, setPreviewMime] = useState<string>("");
  const [previewStoragePath, setPreviewStoragePath] = useState<string>("");
  const [previewOriginalName, setPreviewOriginalName] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  const [_voidReason, _setVoidReason] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleComplete = async () => {
    setIsSaving(true);
    try {
      await completeBlApp.mutateAsync({
        documentId: doc.id,
        payload: {
          bl_number: blNumber.trim() || null,
          status: "FINAL",
          completed_at: new Date().toISOString(),
        },
      });
      toast.success("BL-APP enregistré ✓");
      onBack();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "inconnue";
      toast.error("Erreur : " + message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    try {
      await uploadFile.mutateAsync({
        establishmentId: doc.establishment_id,
        blAppDocumentId: doc.id,
        file,
      });
      toast.success("Fichier importé ✓");
      refetchFiles();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "inconnue";
      toast.error("Erreur upload : " + message);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  };

  const handleViewFile = async (
    storagePath: string,
    originalName: string | null,
    mimeType: string | null
  ) => {
    try {
      const url = await getBlAppFileSignedUrl(storagePath);
      setPreviewUrl(url);
      setPreviewName(originalName ?? "Fichier");
      setPreviewMime(mimeType ?? "");
      setPreviewStoragePath(storagePath);
      setPreviewOriginalName(originalName);
    } catch {
      toast.error("Impossible d'ouvrir le fichier");
    }
  };

  const handleDownloadFile = async (storagePath: string, originalName: string | null) => {
    try {
      const url = await getBlAppFileSignedUrl(storagePath);
      // Fetch as blob to force download (signed URLs are cross-origin, so <a download> is ignored)
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = blobUrl;
      a.download = originalName ?? "bl-app-file";
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("Impossible de télécharger le fichier");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-semibold">{doc.bl_number || "BL manquant"}</h2>
          <p className="text-sm text-muted-foreground">
            {doc.supplier_name_snapshot ?? "Fournisseur inconnu"} —{" "}
            {new Date(doc.bl_date).toLocaleDateString("fr-FR")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {corrections.length > 0 && (
            <Badge variant="outline" className="gap-1 border-primary/50 text-primary">
              <Wrench className="h-3 w-3" />
              Corrigé ({corrections.filter((c) => c.status === "POSTED").length})
            </Badge>
          )}
          <Badge variant={doc.status === "FINAL" ? "default" : "secondary"} className="gap-1">
            {doc.status === "FINAL" ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
            {doc.status === "FINAL" ? "Complet" : "À compléter"}
          </Badge>
        </div>
      </div>

      {/* Lines table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produits réceptionnés</CardTitle>
        </CardHeader>
        <CardContent>
          {linesLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : effectiveLines.length === 0 ? (
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
                  {effectiveLines.map((line) => (
                    <tr
                      key={line.id}
                      className={`border-b last:border-0 ${line.has_correction ? "bg-primary/5" : ""}`}
                    >
                      <td className="py-2">
                      {displayProductName(line.product_name)}
                        {line.has_correction && line.original_quantity === 0 && (
                          <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 border-primary/40 text-primary">
                            Ajouté
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {line.has_correction ? (
                          <span className="flex items-center justify-end gap-1">
                            {line.original_quantity > 0 && (
                              <span className="text-muted-foreground line-through text-xs">
                                {line.has_billing_projection
                                  ? line.billing_quantity
                                  : line.original_quantity}
                              </span>
                            )}
                            <span className="text-primary font-semibold">{line.billing_quantity}</span>
                          </span>
                        ) : (
                          line.billing_quantity
                        )}
                      </td>
                      <td className="py-2 text-right text-muted-foreground">{line.billing_unit_label}</td>
                      {line.projection_error ? (
                        <td colSpan={2} className="py-2 text-right">
                          <span
                            className="inline-flex items-center gap-1 text-xs font-medium text-destructive bg-destructive/10 border border-destructive/30 rounded px-1.5 py-0.5"
                            title={line.projection_error}
                          >
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            Erreur projection
                          </span>
                        </td>
                      ) : (
                        <>
                          <td className="py-2 text-right text-muted-foreground">
                            {line.billing_unit_price_display}
                          </td>
                          <td className="py-2 text-right font-mono font-medium">
                            {line.line_total_value !== null ? (
                              line.billing_line_total_display
                            ) : line.billing_unit_price_value !== null ? (
                              `${(Math.round(line.billing_quantity * line.billing_unit_price_value * 100) / 100).toFixed(2)} €`
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 text-xs font-medium text-warning bg-warning/10 border border-warning/30 rounded px-1.5 py-0.5"
                                title="Prix ou unité manquants au moment de la création du BL"
                              >
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                Non calculable
                              </span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2">
                    <td colSpan={4} className="py-3 text-right font-semibold">
                      Total BL {hasPostedCorrections && <span className="text-xs text-primary font-normal ml-1">(corrigé)</span>}
                    </td>
                    <td className="py-3 text-right font-mono font-bold text-base">
                      {effectiveTotalDisplay}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Files */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Fichiers BL</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Image className="h-4 w-4 mr-1" />
              Bibliothèque
            </Button>
            <Button variant="outline" size="sm" onClick={() => cameraInputRef.current?.click()}>
              <Camera className="h-4 w-4 mr-1" />
              Photo
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={handleFileSelect}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileSelect}
          />
        </CardHeader>
        <CardContent>
          {uploadFile.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Upload en cours…
            </div>
          )}
          {filesLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : files.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">Aucun fichier attaché</p>
          ) : (
            <div className="space-y-2">
              {files.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm truncate">{f.original_name ?? "Fichier"}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleViewFile(f.storage_path, f.original_name, f.mime_type)}
                      title="Visualiser"
                      aria-label="Visualiser le fichier"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDownloadFile(f.storage_path, f.original_name)}
                      title="Télécharger"
                      aria-label="Télécharger le fichier"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Complete button for DRAFT */}
      {doc.status === "DRAFT" && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-2">
              <Label>Numéro de BL</Label>
              <Input
                placeholder="Ex: BL-2026-001"
                value={blNumber}
                onChange={(e) => setBlNumber(e.target.value)}
              />
            </div>
            <Button className="w-full" onClick={handleComplete} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Compléter le BL-APP
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Corriger BL button (POSTED documents only) */}
      {doc.status === "FINAL" && stockDocMeta && (
        <Button variant="outline" className="w-full gap-2" onClick={() => setCorrectionOpen(true)}>
          <Wrench className="h-4 w-4" />
          Corriger le BL
        </Button>
      )}

      {/* Annuler la réception — VOID stock (FINAL documents only) */}
      {doc.status === "FINAL" && stockDocMeta && (
        <>
          <Button
            variant="outline"
            className="w-full gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={() => setVoidConfirmOpen(true)}
            disabled={isVoiding}
          >
            <Ban className="h-4 w-4" />
            Annuler la réception
          </Button>

          <AlertDialog open={voidConfirmOpen} onOpenChange={setVoidConfirmOpen}>
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Annuler la réception
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    <p>
                      Cette action <strong>retire du stock</strong> toutes les quantités de ce BL.
                      Des mouvements inverses seront créés (traçabilité complète).
                    </p>
                    {effectiveLines.length > 0 && (
                      <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-1 max-h-48 overflow-auto">
                        <p className="text-xs font-medium text-destructive mb-2">
                          Impact sur le stock :
                        </p>
                        {effectiveLines.map((line) => (
                          <div key={line.id} className="flex justify-between text-sm">
                            <span className="truncate mr-2">{displayProductName(line.product_name)}</span>
                            <span className="font-mono text-destructive shrink-0">
                              −{line.quantity} {line.unit_label}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Ne pas annuler</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={isVoiding}
                  onClick={async () => {
                    const result = await voidDocument({
                      documentId: doc.stock_document_id,
                      voidReason: "Annulation réception via BL-APP",
                    });
                    if (result.ok) {
                      // Soft-delete the BL-APP document (set voided_at + void_reason)
                      try {
                        await voidBlApp.mutateAsync({
                          documentId: doc.id,
                          voidReason: "Annulation réception via BL-APP",
                        });
                      } catch {
                        // Best-effort: stock already voided
                      }
                      toast.success("Réception annulée — stock retiré et BL archivé ✓");
                      onBack();
                    } else {
                      toast.error(`Erreur : ${result.error ?? "inconnue"}`);
                    }
                  }}
                >
                  {isVoiding ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Ban className="h-4 w-4 mr-1" />
                  )}
                  Annuler la réception
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      {/* Corrections history */}
      {corrections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Corrections appliquées</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {corrections.map((c, idx) => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Correction #{idx + 1}</span>
                  <Badge
                    variant={
                      c.status === "POSTED"
                        ? "default"
                        : c.status === "VOID"
                          ? "destructive"
                          : "secondary"
                    }
                    className="text-xs"
                  >
                    {c.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {c.posted_at ? new Date(c.posted_at).toLocaleDateString("fr-FR") : "—"}
                  </span>
                  {c.status === "POSTED" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      disabled={isVoiding}
                      onClick={async () => {
                        const result = await voidDocument({
                          documentId: c.id,
                          voidReason: "Annulation correction BL",
                        });
                        if (result.ok) {
                          // P0-4: Recompute corrections_count after VOID
                          const { count } = await supabase
                            .from("stock_documents")
                            .select("id", { count: "exact", head: true })
                            .eq("corrects_document_id", doc.stock_document_id)
                            .eq("status", "POSTED");
                          await supabase
                            .from("bl_app_documents")
                            .update({ corrections_count: count ?? 0 })
                            .eq("id", doc.id);
                          toast.success("Correction annulée ✓");
                        } else {
                          toast.error(`Erreur : ${result.error ?? "inconnue"}`);
                        }
                      }}
                    >
                      <Ban className="h-3 w-3 mr-1" />
                      Annuler
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Correction dialog */}
      {stockDocMeta && (
        <BlAppCorrectionDialog
          open={correctionOpen}
          onOpenChange={setCorrectionOpen}
          blDocument={doc}
          stockDocMeta={stockDocMeta}
        />
      )}

      {/* File preview dialog */}
      <Dialog
        open={!!previewUrl}
        onOpenChange={(open) => {
          if (!open) setPreviewUrl(null);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="truncate">{previewName}</span>
              {previewUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownloadFile(previewStoragePath, previewOriginalName)}
                  className="ml-2"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Télécharger
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto bg-muted rounded-lg">
            {previewUrl &&
              (previewMime === "application/pdf" ? (
                <iframe src={previewUrl} className="w-full h-[70vh] border-0" title={previewName} />
              ) : (
                <img
                  src={previewUrl}
                  alt={previewName}
                  className="max-w-full max-h-[70vh] mx-auto object-contain p-4"
                />
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

