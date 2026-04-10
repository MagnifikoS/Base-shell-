/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — ProductV3EntryChoiceModal
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Modal de choix avant V3 Wizard ou Fiche Produit V2.
 * 
 * COMPORTEMENTS:
 * - "Conditionnement" → ouvre le wizard V3 actuel (existant, inchangé)
 * - "Fiche produit" → navigue vers /produits-v2/:id (SSOT Produits V2)
 * 
 * RÈGLES:
 * - "Fiche produit" disabled si productId non défini (ligne non matchée)
 * - Aucune logique métier, aucun formulaire, juste wiring
 * 
 * ROLLBACK: Supprimer ce fichier + retirer l'import dans ExtractedProductsModal
 */

import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Package, FileEdit } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ProductV3EntryChoiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Product ID if line is matched (from confirmedMatches or auto-match) */
  productId: string | null;
  /** Called when user chooses "Conditionnement" */
  onChooseConditionnement: () => void;
}

export function ProductV3EntryChoiceModal({
  open,
  onOpenChange,
  productId,
  onChooseConditionnement,
}: ProductV3EntryChoiceModalProps) {
  const navigate = useNavigate();
  
  const hasProduct = !!productId;

  const handleConditionnement = () => {
    onOpenChange(false);
    onChooseConditionnement();
  };

  const handleFicheProduit = () => {
    if (!productId) return;
    onOpenChange(false);
    // Navigate to existing Produits V2 detail page (SSOT)
    navigate(`/produits-v2/${productId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ouvrir…</DialogTitle>
          <DialogDescription>
            Que souhaitez-vous modifier pour ce produit ?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-4">
          {/* Conditionnement - Always available */}
          <Button
            variant="default"
            className="w-full justify-start gap-3 h-12"
            onClick={handleConditionnement}
          >
            <Package className="h-5 w-5" />
            <span className="font-medium">Conditionnement</span>
          </Button>

          {/* Fiche produit - Only if matched */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full">
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-3 h-12"
                    onClick={handleFicheProduit}
                    disabled={!hasProduct}
                  >
                    <FileEdit className="h-5 w-5" />
                    <span className="font-medium">Fiche produit</span>
                  </Button>
                </div>
              </TooltipTrigger>
              {!hasProduct && (
                <TooltipContent side="bottom">
                  <p className="text-xs">
                    Disponible après association à un produit.
                  </p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}
