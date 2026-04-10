/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FACTURES — Invoice Preview Component V1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Aperçu rapide d'une facture (lazy load du fichier).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Invoice } from "../types";
import { getInvoicePreviewUrl } from "../services/invoiceService";

interface InvoicePreviewProps {
  invoice: Invoice;
  onClose: () => void;
}

export function InvoicePreview({ invoice, onClose }: InvoicePreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadPreview = async () => {
      setLoading(true);
      setError(false);

      // Guard against missing file_path
      if (!invoice.file_path) {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
        return;
      }

      try {
        const url = await getInvoicePreviewUrl(invoice.file_path);
        if (!cancelled) {
          if (url) {
            setPreviewUrl(url);
          } else {
            setError(true);
          }
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error("[InvoicePreview] load error:", err);
        if (!cancelled) {
          setError(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [invoice.file_path]);

  const isPdf = invoice.file_type === "application/pdf";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center justify-between">
            <span>
              Facture {invoice.invoice_number || "—"} —{" "}
              {new Date(invoice.invoice_date).toLocaleDateString("fr-FR")}
            </span>
            {previewUrl && (
              <Button variant="outline" size="sm" onClick={() => window.open(previewUrl, "_blank")}>
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
              <p className="font-medium">Impossible de charger l'aperçu</p>
              <p className="text-sm">
                {!invoice.file_path
                  ? "Aucun fichier associé à cette facture."
                  : "Le fichier est peut-être indisponible ou le lien a expiré."}
              </p>
            </div>
          )}

          {previewUrl && !loading && !error && (
            <>
              {isPdf ? (
                <iframe
                  src={previewUrl}
                  className="w-full h-[70vh] border-0"
                  title={`Aperçu ${invoice.invoice_number}`}
                />
              ) : (
                <img
                  src={previewUrl}
                  alt={`Facture ${invoice.invoice_number}`}
                  className="max-w-full max-h-[70vh] mx-auto object-contain"
                />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
