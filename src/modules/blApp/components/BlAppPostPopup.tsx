/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE BL-APP — Popup Terrain (V1)
 *
 * Two modes:
 *  A) Post-POST (legacy/desktop): stock already posted, just capture BL info.
 *  B) Pre-POST (mobile unified): this popup IS the confirmation.
 *     "Valider" → post stock → create BL-APP → done.
 *     "Annuler" → nothing happens.
 *
 * Ultra-simple: 1 écran, 0 scroll, < 5 secondes.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useRef } from "react";
import { Camera, X, Check, Loader2, Send, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCreateBlApp } from "../hooks/useCreateBlApp";
import { useCompleteBlApp } from "../hooks/useCompleteBlApp";
import { useUploadBlAppFile } from "../hooks/useUploadBlAppFile";
import type { CreateBlAppPayload, BlAppDocument } from "../types";
import { formatParisDateKey } from "@/lib/time/dateKeyParis";

interface BlAppPostPopupProps {
  open: boolean;
  onClose: () => void;
  stockDocumentId: string;
  establishmentId: string;
  supplierId: string | null;
  supplierName: string | null;
  userId: string;
  /**
   * Pre-POST mode (mobile): if provided, "Valider" calls this first.
   * Must return { ok: true } or { ok: false, error: string }.
   * If ok, BL-APP is created afterwards.
   */
  onPostStock?: () => Promise<{ ok: boolean; error?: string }>;
  /** Number of lines — shown in the CTA when in pre-post mode */
  linesCount?: number;
}

export function BlAppPostPopup({
  open,
  onClose,
  stockDocumentId,
  establishmentId,
  supplierId,
  supplierName,
  userId,
  onPostStock,
  linesCount,
}: BlAppPostPopupProps) {
  const isPrePost = !!onPostStock;

  const [blNumber, setBlNumber] = useState("");
  const [blAppDoc, setBlAppDoc] = useState<BlAppDocument | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [postErrorMsg, setPostErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const createBlApp = useCreateBlApp();
  const completeBlApp = useCompleteBlApp();
  const uploadFile = useUploadBlAppFile();

  // In post-POST mode (legacy), create BL-APP on open
  useEffect(() => {
    if (!open || isPrePost || blAppDoc || isCreating) return;
    createBlAppFromStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stockDocumentId]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setBlNumber("");
      setBlAppDoc(null);
      setThumbnailUrl(null);
      setIsCreating(false);
      setIsSaving(false);
      setPostErrorMsg(null);
      setPendingFile(null);
    }
  }, [open]);

  const createBlAppFromStock = async () => {
    setIsCreating(true);
    try {
      const { data: stockLines, error: linesErr } = await supabase
        .from("stock_document_lines")
        .select("product_id, delta_quantity_canonical, canonical_unit_id, context_hash")
        .eq("document_id", stockDocumentId);

      if (linesErr) throw linesErr;

      const payload: CreateBlAppPayload = {
        establishment_id: establishmentId,
        stock_document_id: stockDocumentId,
        supplier_id: supplierId,
        supplier_name_snapshot: supplierName,
        bl_date: formatParisDateKey(new Date()),
        created_by: userId,
        lines: (stockLines ?? []).map((l) => ({
          product_id: l.product_id,
          quantity_canonical: l.delta_quantity_canonical,
          canonical_unit_id: l.canonical_unit_id,
          context_hash: l.context_hash ?? null,
        })),
      };

      const result = await createBlApp.mutateAsync(payload);
      return result.document;
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error("[BlAppPostPopup] create error:", err);
      toast.error("Erreur création BL-APP");
      return null;
    } finally {
      setIsCreating(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (isPrePost) {
      // In pre-post mode, defer upload until after POST
      setPendingFile(file);
      if (file.type.startsWith("image/")) {
        setThumbnailUrl(URL.createObjectURL(file));
      } else {
        setThumbnailUrl("pdf");
      }
      return;
    }

    // Legacy mode: upload immediately
    if (!blAppDoc) return;
    try {
      await uploadFile.mutateAsync({
        establishmentId,
        blAppDocumentId: blAppDoc.id,
        file,
      });
      if (file.type.startsWith("image/")) {
        setThumbnailUrl(URL.createObjectURL(file));
      } else {
        setThumbnailUrl("pdf");
      }
      toast.success("Photo ajoutée ✓");
    } catch (_err: unknown) {
      toast.error("Erreur upload");
    }
  };

  const handleRemovePhoto = () => {
    setThumbnailUrl(null);
    setPendingFile(null);
  };

  // Background photo upload state
  const [_photoStatus, setPhotoStatus] = useState<"idle" | "uploading" | "done" | "failed">("idle");
  const [bgUploadDocId, setBgUploadDocId] = useState<string | null>(null);
  const [bgUploadFile, setBgUploadFile] = useState<File | null>(null);

  const _retryPhotoUpload = async () => {
    if (!bgUploadFile || !bgUploadDocId) return;
    setPhotoStatus("uploading");
    try {
      await Promise.race([
        uploadFile.mutateAsync({
          establishmentId,
          blAppDocumentId: bgUploadDocId,
          file: bgUploadFile,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20000)),
      ]);
      setPhotoStatus("done");
      setBgUploadFile(null);
      toast.success("Photo envoyée ✓");
    } catch {
      setPhotoStatus("failed");
      toast.error("Upload photo échoué — réessayer");
    }
  };

  const handleValidate = async () => {
    setIsSaving(true);
    setPostErrorMsg(null);

    try {
      // ── Step 1: POST stock (pre-post mode only) ──
      if (isPrePost && onPostStock) {
        const result = await onPostStock();
        if (!result.ok) {
          const messages: Record<string, string> = {
            LOCK_CONFLICT: "Conflit — le document a été modifié. Rechargez.",
            NO_ACTIVE_SNAPSHOT: "Aucun inventaire de référence pour cette zone.",
            DEFAULT_RECEIPT_ZONE_MISSING: "Zone de réception par défaut non configurée.",
            
          };
          setPostErrorMsg(messages[result.error ?? ""] ?? `Erreur : ${result.error}`);
          return;
        }
      }

      // ── Step 2: Create BL-APP (idempotent) ──
      let doc = blAppDoc;
      if (!doc) {
        doc = (await createBlAppFromStock()) ?? null;
        if (!doc) return;
        setBlAppDoc(doc);
      }

      // ── Step 3: Complete BL-APP (without waiting for photo) ──
      await completeBlApp.mutateAsync({
        documentId: doc.id,
        payload: {
          bl_number: blNumber.trim() || null,
          status: "FINAL",
          completed_at: new Date().toISOString(),
        },
      });

      toast.success(isPrePost ? "Réception validée + BL enregistré ✓" : "BL enregistré ✓");

      // ── Step 4: Upload photo in background (non-blocking) ──
      if (pendingFile && doc) {
        setBgUploadDocId(doc.id);
        setBgUploadFile(pendingFile);
        setPhotoStatus("uploading");
        // Fire-and-forget with timeout
        Promise.race([
          uploadFile.mutateAsync({
            establishmentId,
            blAppDocumentId: doc.id,
            file: pendingFile,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20000)),
        ])
          .then(() => {
            setPhotoStatus("done");
            setBgUploadFile(null);
            toast.success("Photo BL envoyée ✓");
          })
          .catch(() => {
            setPhotoStatus("failed");
            toast.error("Upload photo échoué — réessayer via le bandeau");
          });
      }

      onClose();
    } catch (_err: unknown) {
      toast.error("Erreur enregistrement");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isSaving && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-md p-0 gap-0 rounded-2xl overflow-hidden border-0">
        {!isPrePost && isCreating ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Préparation…</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {/* ── Header ── */}
            <div className="px-5 pt-5 pb-3">
              <h2 className="text-lg font-semibold text-foreground">
                {isPrePost ? "Confirmer la réception" : "Bon de Livraison"}
              </h2>
              {!isPrePost && (
                <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
                  <Check className="h-3.5 w-3.5" />
                  Réception validée
                </p>
              )}
              {isPrePost && linesCount != null && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {linesCount} produit{linesCount > 1 ? "s" : ""} · {supplierName ?? "Fournisseur"}
                </p>
              )}
            </div>

            {/* ── Post error ── */}
            {postErrorMsg && (
              <div className="mx-5 mb-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <span className="text-sm text-destructive">{postErrorMsg}</span>
              </div>
            )}

            {/* ── BL Number ── */}
            <div className="px-5 pb-3">
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                Numéro de BL <span className="text-muted-foreground font-normal">(optionnel)</span>
              </label>
              <Input
                autoFocus
                inputMode="text"
                placeholder="Ex: BL-4587"
                value={blNumber}
                onChange={(e) => setBlNumber(e.target.value)}
                className="h-12 text-base rounded-xl"
              />
              <button
                type="button"
                className="text-xs text-muted-foreground mt-1.5 hover:text-foreground transition-colors"
                onClick={() => setBlNumber("BL-MANQUANT")}
              >
                Je n'ai pas de numéro
              </button>
            </div>

            {/* ── Photo ── */}
            <div className="px-5 pb-4">
              {thumbnailUrl ? (
                <div className="relative inline-block">
                  {thumbnailUrl === "pdf" ? (
                    <div className="w-20 h-20 rounded-xl bg-muted flex items-center justify-center text-xs text-muted-foreground font-medium">
                      PDF
                    </div>
                  ) : (
                    <img
                      src={thumbnailUrl}
                      alt="BL"
                      className="w-20 h-20 rounded-xl object-cover"
                    />
                  )}
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5"
                    aria-label="Supprimer la photo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full h-12 rounded-xl gap-2 text-sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={(!isPrePost && !blAppDoc) || uploadFile.isPending}
                >
                  {uploadFile.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                  Ajouter photo
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>

            {/* ── Actions ── */}
            <div className="px-5 pb-5 flex flex-col gap-2">
              <Button
                className="w-full h-12 rounded-xl text-base font-semibold bg-emerald-600 dark:bg-emerald-700 hover:bg-emerald-700 dark:hover:bg-emerald-600 text-white"
                onClick={handleValidate}
                disabled={isSaving || (!isPrePost && !blAppDoc)}
              >
                {isSaving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : isPrePost ? (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Valider réception
                  </>
                ) : (
                  "Valider"
                )}
              </Button>
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                onClick={onClose}
                disabled={isSaving}
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
