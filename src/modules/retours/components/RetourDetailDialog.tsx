/**
 * RetourDetailDialog — Supplier views and resolves a product return.
 * Also used by client to view return status.
 */

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Package,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useResolveReturn, useReturnPhotos } from "../hooks/useRetours";
import {
  RETURN_TYPE_LABELS,
  RETURN_STATUS_LABELS,
  RETURN_RESOLUTION_LABELS,
} from "../types";
import type { ProductReturn, ReturnResolution } from "../types";
import { supabase } from "@/integrations/supabase/client";
import { useErpQuantityLabels } from "@/modules/commandes/hooks/useErpQuantityLabels";

interface Props {
  open: boolean;
  onClose: () => void;
  productReturn: ProductReturn;
  establishmentNames: Record<string, string>;
}

const RESOLUTIONS: ReturnResolution[] = ["avoir", "remplacement", "retour_physique"];

export function RetourDetailDialog({
  open,
  onClose,
  productReturn,
  establishmentNames,
}: Props) {
  const { activeEstablishment } = useEstablishment();
  const isSupplier = activeEstablishment?.id === productReturn.supplier_establishment_id;

  // ERP formatting for supplier-side display (quantity is in client-space)
  const { formatQty: erpFormat } = useErpQuantityLabels({
    productIds: [productReturn.product_id],
    supplierEstablishmentId: isSupplier ? productReturn.supplier_establishment_id : undefined,
    clientEstablishmentId: isSupplier ? productReturn.client_establishment_id : undefined,
  });
  const isPending = productReturn.status === "pending";

  const resolve = useResolveReturn();
  const { data: photos } = useReturnPhotos(open ? productReturn.id : null);

  const [action, setAction] = useState<"accept" | "refuse" | null>(null);
  const [resolution, setResolution] = useState<ReturnResolution | null>(null);
  const [supplierComment, setSupplierComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!action) return;
    setSubmitting(true);
    try {
      await resolve.mutateAsync({
        returnId: productReturn.id,
        status: action === "accept" ? "accepted" : "refused",
        resolution: action === "accept" ? resolution : null,
        supplierComment: supplierComment.trim() || null,
      });
      toast.success(action === "accept" ? "Retour accepté" : "Retour refusé");
      onClose();
    } catch {
      toast.error("Erreur lors du traitement");
    } finally {
      setSubmitting(false);
    }
  }, [action, resolution, supplierComment, productReturn.id, resolve, onClose]);

  const handleClose = useCallback(() => {
    setAction(null);
    setResolution(null);
    setSupplierComment("");
    onClose();
  }, [onClose]);

  const statusIcon = productReturn.status === "accepted" ? (
    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
  ) : productReturn.status === "refused" ? (
    <XCircle className="h-5 w-5 text-red-500" />
  ) : (
    <Clock className="h-5 w-5 text-amber-500" />
  );

  const clientName = establishmentNames[productReturn.client_establishment_id] || "Client";
  const supplierName = establishmentNames[productReturn.supplier_establishment_id] || "Fournisseur";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md w-[calc(100vw-1rem)] sm:w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {statusIcon}
            Retour — {RETURN_STATUS_LABELS[productReturn.status]}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Info card */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Produit</span>
              <span className="font-medium uppercase">{productReturn.product_name_snapshot}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Quantité</span>
              <span className="font-medium tabular-nums">
                {isSupplier
                  ? erpFormat(productReturn.product_id, productReturn.quantity, productReturn.canonical_unit_id ?? "", productReturn.unit_label_snapshot)
                  : `${productReturn.quantity}${productReturn.unit_label_snapshot ? ` ${productReturn.unit_label_snapshot}` : ""}`
                }
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium">{RETURN_TYPE_LABELS[productReturn.return_type]}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{isSupplier ? "Client" : "Fournisseur"}</span>
              <span className="font-medium">{isSupplier ? clientName : supplierName}</span>
            </div>
          </div>

          {/* Client comment */}
          {productReturn.reason_comment && (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground mb-1">Commentaire client</p>
              <p className="text-sm">{productReturn.reason_comment}</p>
            </div>
          )}

          {/* Photos */}
          {photos && photos.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> Photos ({photos.length})
              </p>
              <div className="flex gap-2 overflow-x-auto">
                {photos.map((p, i) => {
                  const { data: urlData } = supabase.storage
                    .from("return-photos")
                    .getPublicUrl(p.storage_path);
                  return (
                    <img
                      key={i}
                      src={urlData.publicUrl}
                      alt={p.original_name ?? "Photo retour"}
                      className="h-20 w-20 rounded-lg object-cover border"
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Resolution info (if already resolved) */}
          {productReturn.status !== "pending" && (
            <div className="rounded-lg border p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Décision fournisseur</p>
              <p className="text-sm font-medium">
                {productReturn.status === "accepted" && productReturn.resolution
                  ? RETURN_RESOLUTION_LABELS[productReturn.resolution]
                  : RETURN_STATUS_LABELS[productReturn.status]}
              </p>
              {productReturn.supplier_comment && (
                <p className="text-sm text-muted-foreground mt-1">
                  {productReturn.supplier_comment}
                </p>
              )}
            </div>
          )}

          {/* Supplier action buttons (only if pending + supplier) */}
          {isSupplier && isPending && !action && (
            <div className="flex gap-2">
              <Button
                onClick={() => setAction("accept")}
                className="flex-1"
                variant="default"
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Accepter
              </Button>
              <Button
                onClick={() => setAction("refuse")}
                className="flex-1"
                variant="outline"
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Refuser
              </Button>
            </div>
          )}

          {/* Accept flow: choose resolution */}
          {action === "accept" && (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
              <p className="text-sm font-medium">Quelle solution ?</p>
              <div className="space-y-2">
                {RESOLUTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setResolution(r)}
                    className={`w-full text-left px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
                      resolution === r
                        ? "bg-primary text-primary-foreground border-primary"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    {RETURN_RESOLUTION_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comment + submit (for both accept/refuse) */}
          {action && (
            <div className="space-y-3 animate-in fade-in">
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Commentaire <span className="text-muted-foreground font-normal">(optionnel)</span>
                </label>
                <Textarea
                  value={supplierComment}
                  onChange={(e) => setSupplierComment(e.target.value)}
                  placeholder="Ajouter un commentaire..."
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setAction(null);
                    setResolution(null);
                  }}
                  className="flex-1"
                >
                  Annuler
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || (action === "accept" && !resolution)}
                  className="flex-1"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  Confirmer
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
