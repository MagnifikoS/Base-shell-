/**
 * Supplier Delete Dialog - Archive or Hard Delete with confirmation
 */

import { useState, useEffect } from "react";
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
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import type { Supplier } from "../services/supplierService";

interface SupplierDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: Supplier | null;
  onArchive: () => Promise<void>;
  onHardDelete: () => Promise<void>;
  getProductsCount: (id: string) => Promise<number>;
}

export function SupplierDeleteDialog({
  open,
  onOpenChange,
  supplier,
  onArchive,
  onHardDelete,
  getProductsCount,
}: SupplierDeleteDialogProps) {
  const [productsCount, setProductsCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [showHardDeleteConfirm, setShowHardDeleteConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (open && supplier) {
      setLoading(true);
      setShowHardDeleteConfirm(false);
      getProductsCount(supplier.id)
        .then(setProductsCount)
        .finally(() => setLoading(false));
    }
  }, [open, supplier, getProductsCount]);

  const handleArchive = async () => {
    setActionLoading(true);
    try {
      await onArchive();
      onOpenChange(false);
    } finally {
      setActionLoading(false);
    }
  };

  const handleHardDelete = async () => {
    setActionLoading(true);
    try {
      await onHardDelete();
      onOpenChange(false);
      setShowHardDeleteConfirm(false);
    } finally {
      setActionLoading(false);
    }
  };

  if (!supplier) return null;

  // Second confirmation dialog for hard delete
  if (showHardDeleteConfirm) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Suppression définitive
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Cette action est <strong>irréversible</strong>. Vous allez supprimer définitivement :
              </p>
              <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                <li>Le fournisseur <strong>"{supplier.name}"</strong></li>
                <li><strong>{productsCount}</strong> produit(s) lié(s)</li>
              </ul>
              <p className="mt-3 font-medium">
                Êtes-vous absolument sûr ?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => setShowHardDeleteConfirm(false)}
              disabled={actionLoading}
            >
              Annuler
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleHardDelete}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Supprimer définitivement
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // Main dialog
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archiver ce fournisseur ?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Chargement...
                </div>
              ) : (
                <>
                  <p>
                    Le fournisseur <strong>"{supplier.name}"</strong> sera archivé.
                  </p>
                  {productsCount > 0 && (
                    <p className="text-warning">
                      ⚠️ {productsCount} produit(s) lié(s) seront aussi archivés.
                    </p>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel disabled={actionLoading || loading}>
            Annuler
          </AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleArchive}
            disabled={actionLoading || loading}
          >
            {actionLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Archiver
          </AlertDialogAction>
        </AlertDialogFooter>

        {/* Danger zone for hard delete - only if products exist */}
        {!loading && productsCount > 0 && (
          <div className="mt-4 pt-4 border-t border-destructive/30">
          <div className="flex items-start gap-2 text-sm text-muted-foreground mb-3">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
              <span>
                Zone danger : supprimer définitivement le fournisseur et tous ses produits.
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
              onClick={() => setShowHardDeleteConfirm(true)}
              disabled={actionLoading}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Supprimer définitivement (irréversible)
            </Button>
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
