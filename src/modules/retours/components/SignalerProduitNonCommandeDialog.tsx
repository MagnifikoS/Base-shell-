/**
 * SignalerProduitNonCommandeDialog — Client signals an unordered product received by mistake.
 * Simplified flow: product name → quantity → optional comment/photo → submit.
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
  Camera,
  CheckCircle2,
  Loader2,
  PackagePlus,
} from "lucide-react";
import { toast } from "sonner";
import { useCreateReturn, useUploadReturnPhoto } from "../hooks/useRetours";
import type { Commande } from "@/modules/commandes/types";

interface Props {
  open: boolean;
  onClose: () => void;
  commande: Commande;
}

export function SignalerProduitNonCommandeDialog({ open, onClose, commande }: Props) {
  const [step, setStep] = useState<"form" | "done">("form");
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const createReturn = useCreateReturn();
  const uploadPhoto = useUploadReturnPhoto();

  const handleSubmit = useCallback(async () => {
    if (!productName.trim()) {
      toast.error("Indiquez le nom du produit");
      return;
    }
    setSending(true);
    try {
      const result = await createReturn.mutateAsync({
        commandeId: commande.id,
        commandeLineId: null,
        productId: "00000000-0000-0000-0000-000000000000", // placeholder — déclaratif uniquement, jamais utilisé comme identifiant métier
        productNameSnapshot: `[Hors commande] ${productName.trim()}`,
        quantity,
        canonicalUnitId: null,
        unitLabelSnapshot: null,
        returnType: "produit_en_plus",
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
  }, [productName, quantity, comment, photo, commande, createReturn, uploadPhoto]);

  const handleClose = useCallback(() => {
    setStep("form");
    setProductName("");
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
            {step === "form" ? (
              <>
                <PackagePlus className="h-5 w-5 text-amber-500" />
                Produit non commandé
              </>
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                Signalement envoyé
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {step === "form" && (
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              Signalez un produit reçu qui n'était pas dans la commande.
            </p>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Nom du produit</label>
              <Input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Ex : oignons, beurre…"
                autoFocus
              />
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
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Commentaire <span className="text-muted-foreground font-normal">(optionnel)</span>
              </label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Produit envoyé par erreur…"
                rows={2}
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
              disabled={sending || !productName.trim()}
              className="w-full"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Envoyer le signalement
            </Button>
          </div>
        )}

        {step === "done" && (
          <div className="text-center py-6 space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Le signalement a été transmis au fournisseur.
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
