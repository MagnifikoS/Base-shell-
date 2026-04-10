/**
 * ModalFooter — Footer with cancel, accept-all, and validate buttons.
 * Extracted from ExtractedProductsModal for file-size compliance.
 */

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";

interface ModalFooterProps {
  pendingCount: number;
  totalCount: number;
  onCancel: () => void;
  onAcceptAll: () => void;
  onValidateAll: () => void;
}

export function ModalFooter({
  pendingCount,
  totalCount,
  onCancel,
  onAcceptAll,
  onValidateAll,
}: ModalFooterProps) {
  return (
    <DialogFooter className="flex gap-2 sm:gap-2 pt-4">
      <Button variant="outline" onClick={onCancel}>
        Annuler
      </Button>
      {pendingCount > 0 && (
        <Button
          variant="secondary"
          onClick={onAcceptAll}
          title="Accepter tous les produits tels quels sans les associer"
        >
          Tout accepter tel quel ({pendingCount})
        </Button>
      )}
      <Button
        onClick={onValidateAll}
        disabled={pendingCount > 0}
        title={
          pendingCount > 0
            ? `${pendingCount} produit${pendingCount > 1 ? "s" : ""} \u00e0 compl\u00e9ter \u2014 utilisez \u2713 pour accepter ou associez-les`
            : undefined
        }
      >
        {pendingCount > 0
          ? `Valider tous les produits (${totalCount - pendingCount}/${totalCount})`
          : `Valider tous les produits (${totalCount})`}
      </Button>
    </DialogFooter>
  );
}
