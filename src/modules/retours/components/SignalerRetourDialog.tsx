/**
 * SignalerRetourDialog — Client signals a product quality/issue return.
 * Step 1: Choose return type
 * Step 2: Quantity + comment + optional photo
 * Step 3: Confirmation
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
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Loader2,
  Package,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useCreateReturn, useUploadReturnPhoto } from "../hooks/useRetours";
import { RETURN_TYPE_LABELS } from "../types";
import type { ReturnType } from "../types";
import type { CommandeLine, Commande } from "@/modules/commandes/types";

/** Data shape for a locally-staged return (not yet persisted) */
export interface PendingReturnData {
  commandeLineId: string;
  productId: string;
  productNameSnapshot: string;
  quantity: number;
  canonicalUnitId: string | null;
  unitLabelSnapshot: string | null;
  returnType: ReturnType;
  reasonComment: string | null;
  photo: File | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commande: Commande;
  line: CommandeLine;
  /**
   * When provided, the dialog stores the return locally instead of writing to DB.
   * Used during reception flow to defer persistence until final validation.
   */
  onLocalSubmit?: (data: PendingReturnData) => void;
}

const RETURN_TYPES: ReturnType[] = [
  "mauvais_produit",
  "produit_en_plus",
  "produit_casse",
  "dlc_depassee",
  "dlc_trop_proche",
  "non_conforme",
];

export function SignalerRetourDialog({ open, onClose, commande, line, onLocalSubmit }: Props) {
  const [step, setStep] = useState<"type" | "details" | "done">("type");
  const [returnType, setReturnType] = useState<ReturnType | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const createReturn = useCreateReturn();
  const uploadPhoto = useUploadReturnPhoto();

  const handleSelectType = useCallback((type: ReturnType) => {
    setReturnType(type);
    setStep("details");
  }, []);

  const handleBack = useCallback(() => {
    if (step === "details") {
      setStep("type");
      setReturnType(null);
    }
  }, [step]);

  const handleSubmit = useCallback(async () => {
    if (!returnType) return;

    // Local-only mode: stage the return without persisting to DB
    if (onLocalSubmit) {
      onLocalSubmit({
        commandeLineId: line.id,
        productId: line.product_id,
        productNameSnapshot: line.product_name_snapshot,
        quantity,
        canonicalUnitId: line.canonical_unit_id,
        unitLabelSnapshot: line.unit_label_snapshot,
        returnType,
        reasonComment: comment.trim() || null,
        photo,
      });
      setStep("done");
      return;
    }

    // Standard mode: persist to DB immediately
    setSending(true);
    try {
      const result = await createReturn.mutateAsync({
        commandeId: commande.id,
        commandeLineId: line.id,
        productId: line.product_id,
        productNameSnapshot: line.product_name_snapshot,
        quantity,
        canonicalUnitId: line.canonical_unit_id,
        unitLabelSnapshot: line.unit_label_snapshot,
        returnType,
        reasonComment: comment.trim() || null,
        clientEstablishmentId: commande.client_establishment_id,
        supplierEstablishmentId: commande.supplier_establishment_id,
      });

      if (photo) {
        try {
          await uploadPhoto.mutateAsync({ returnId: result.id, file: photo });
        } catch {
          toast.warning("Retour créé, mais la photo n'a pas pu être envoyée.");
        }
      }

      setStep("done");
    } catch {
      toast.error("Erreur lors de la création du retour");
    } finally {
      setSending(false);
    }
  }, [returnType, quantity, comment, photo, commande, line, createReturn, uploadPhoto, onLocalSubmit]);

  const handleClose = useCallback(() => {
    setStep("type");
    setReturnType(null);
    setQuantity(1);
    setComment("");
    setPhoto(null);
    onClose();
  }, [onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md w-[calc(100vw-1rem)] sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {step === "type" && (
              <>
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Signaler un problème
              </>
            )}
            {step === "details" && (
              <>
                <button onClick={handleBack} className="p-1 rounded hover:bg-accent">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <Package className="h-5 w-5" />
                {line.product_name_snapshot}
              </>
            )}
            {step === "done" && (
              <>
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                Retour envoyé
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {step === "type" && (
          <div className="space-y-2 mt-2">
            <p className="text-sm text-muted-foreground mb-3">
              Quel type de problème pour <span className="font-medium text-foreground">{line.product_name_snapshot}</span> ?
            </p>
            {RETURN_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => handleSelectType(type)}
                className="w-full text-left px-4 py-3 rounded-lg border hover:bg-accent/50 transition-colors text-sm font-medium"
              >
                {RETURN_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        )}

        {step === "details" && returnType && (
          <div className="space-y-4 mt-2">
            <div className="px-3 py-2 rounded-lg bg-accent/50 border text-sm">
              <span className="text-muted-foreground">Type : </span>
              <span className="font-medium">{RETURN_TYPE_LABELS[returnType]}</span>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Quantité</label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                className="w-32"
              />
              {line.unit_label_snapshot && (
                <span className="text-xs text-muted-foreground ml-2">
                  {line.unit_label_snapshot}
                </span>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Commentaire <span className="text-muted-foreground font-normal">(optionnel)</span>
              </label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Décrivez le problème..."
                rows={3}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Photo <span className="text-muted-foreground font-normal">(optionnel)</span>
              </label>
              <label className="flex items-center gap-2 px-4 py-3 rounded-lg border border-dashed cursor-pointer hover:bg-accent/50 transition-colors text-sm text-muted-foreground">
                <Camera className="h-4 w-4" />
                {photo ? photo.name : "Ajouter une photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={sending || createReturn.isPending}
              className="w-full"
            >
              {(sending || createReturn.isPending) ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Envoyer le retour
            </Button>
          </div>
        )}

        {step === "done" && (
          <div className="text-center py-6 space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Le retour a été transmis au fournisseur.
              <br />
              Vous serez informé de la réponse.
            </p>
            <Button onClick={handleClose} variant="outline">
              Fermer
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
