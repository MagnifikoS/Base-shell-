/**
 * Fournisseurs Page - Grid listing, click navigates to detail page
 * Includes B2B partner section for restaurant establishments
 * Includes B2B catalogue browser when viewing a partner's catalogue
 */

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSuppliers } from "../hooks/useSuppliers";
import { SuppliersList } from "../components/SuppliersList";
import { SupplierDeleteDialog } from "../components/SupplierDeleteDialog";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import type { Supplier } from "../services/supplierService";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { RedeemCodeDialog, PartnershipList, B2BPartnerCatalogView } from "@/modules/clientsB2B";

export function FournisseursPage() {
  const { suppliers, isLoading, error, archiveSupplier, deleteSupplierHard, getProductsCount } =
    useSuppliers();
  const navigate = useNavigate();
  const { activeEstablishment } = useEstablishment();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);

  // B2B catalogue state
  const [catalogView, setCatalogView] = useState<{
    partnershipId: string;
    partnerName: string;
  } | null>(null);

  const isRestaurant = activeEstablishment?.establishment_type === "restaurant";

  const handleDelete = (supplier: Supplier) => {
    setSupplierToDelete(supplier);
    setDeleteDialogOpen(true);
  };

  const handleArchive = async () => {
    if (supplierToDelete) {
      await archiveSupplier(supplierToDelete.id);
    }
  };

  const handleHardDelete = async () => {
    if (supplierToDelete) {
      await deleteSupplierHard(supplierToDelete.id);
    }
  };

  const handleViewCatalog = useCallback((partnershipId: string, partnerName: string) => {
    setCatalogView({ partnershipId, partnerName: partnerName || "Fournisseur" });
  }, []);

  // Show catalogue browser if active
  if (catalogView) {
    return (
      <B2BPartnerCatalogView
        partnershipId={catalogView.partnershipId}
        partnerName={catalogView.partnerName}
        onBack={() => setCatalogView(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fournisseurs</h1>
          <p className="text-muted-foreground mt-1">Gérez vos fournisseurs et leurs informations</p>
        </div>
        <div className="flex items-center gap-2">
          {isRestaurant && <RedeemCodeDialog />}
          <Button onClick={() => navigate("/fournisseurs/nouveau")}>
            <Plus className="h-4 w-4 mr-2" />
            Nouveau fournisseur
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
          <p className="text-sm text-destructive">{error.message}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : suppliers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Aucun fournisseur enregistré</p>
          <p className="text-sm mt-1">
            Créez votre premier fournisseur ou importez une facture via Vision AI
          </p>
        </div>
      ) : (
        <SuppliersList suppliers={suppliers} onEdit={() => {}} onDelete={handleDelete} />
      )}

      {/* B2B Partner Suppliers (restaurant only) */}
      {isRestaurant && (
        <div className="space-y-4 pt-4 border-t">
          <h2 className="text-lg font-semibold">Fournisseurs partenaires B2B</h2>
          <PartnershipList viewAs="client" onViewCatalog={handleViewCatalog} />
        </div>
      )}

      <SupplierDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        supplier={supplierToDelete}
        onArchive={handleArchive}
        onHardDelete={handleHardDelete}
        getProductsCount={getProductsCount}
      />
    </div>
  );
}
