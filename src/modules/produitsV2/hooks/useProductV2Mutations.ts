/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — useProductV2Mutations Hook
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mutations for Produits V2 module.
 * Includes upsert mutation for V3 Wizard integration.
 *
 * MIGRATION supplier_id (2026-02-09)
 * - supplier_id = SSOT unique pour l'attribution fournisseur
 * - supplier_name = DEPRECATED (jamais écrit)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  createProductV2,
  updateProductV2,
  archiveProductV2,
  deleteProductV2Permanently,
  checkProductV2Collision,
  upsertProductV2,
  type UpsertProductV2Payload,
  type UpsertProductV2Result,
} from "../services/productsV2Service";
import { normalizeProductNameV2 } from "../utils/normalizeProductName";
import type { ProductV2FormData, CollisionCheckResult } from "../types";
import { toast } from "sonner";

export function useProductV2Mutations() {
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();

  const invalidateProducts = () => {
    queryClient.invalidateQueries({ queryKey: ["products-v2", activeEstablishment?.id] });
    queryClient.invalidateQueries({
      queryKey: ["products-v2-categories", activeEstablishment?.id],
    });
    queryClient.invalidateQueries({ queryKey: ["products-v2-suppliers", activeEstablishment?.id] });
    // Cascade: product changes may affect stock calculations & alerts
    queryClient.invalidateQueries({ queryKey: ["estimated-stock"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["stock-alerts"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["desktop-stock"], exact: false });
  };

  // CREATE — supplier_id OBLIGATOIRE
  const create = useMutation({
    mutationFn: async (formData: ProductV2FormData) => {
      if (!activeEstablishment?.id) {
        throw new Error("Aucun établissement sélectionné");
      }

      if (!formData.supplier_id) {
        throw new Error("Fournisseur obligatoire");
      }

      if (!formData.storage_zone_id?.trim()) {
        throw new Error("Zone de stockage obligatoire");
      }

      return createProductV2({
        establishment_id: activeEstablishment.id,
        code_produit: formData.code_produit.trim() || null,
        code_barres: formData.code_barres.trim() || null,
        nom_produit: formData.nom_produit.trim(),
        nom_produit_fr: formData.nom_produit_fr.trim() || null,
        name_normalized: normalizeProductNameV2(formData.nom_produit),
        variant_format: formData.variant_format.trim() || null,
        // category text intentionally omitted — SSOT is category_id
        category_id: formData.category_id?.trim() || null,
        supplier_id: formData.supplier_id, // SSOT — OBLIGATOIRE
        supplier_billing_unit_id: formData.supplier_billing_unit_id?.trim() || null,
        storage_zone_id: formData.storage_zone_id?.trim() || null,
        conditionnement_config: formData.conditionnement_config,
        conditionnement_resume: formData.conditionnement_resume.trim() || null,
        final_unit_price: formData.final_unit_price ? parseFloat(formData.final_unit_price) : null,
        final_unit_id: formData.final_unit_id?.trim() || null,
        stock_handling_unit_id: formData.stock_handling_unit_id?.trim() || null,
        kitchen_unit_id: formData.kitchen_unit_id?.trim() || null,
        delivery_unit_id: formData.delivery_unit_id?.trim() || null,
        price_display_unit_id: formData.price_display_unit_id?.trim() || null,
        info_produit: formData.info_produit.trim() || null,
        created_by: user?.id ?? null,
      });
    },
    onSuccess: () => {
      invalidateProducts();
      toast.success("Produit créé avec succès");
    },
    onError: (error: Error) => {
      if (error.message.includes("idx_products_v2_establishment_barcode")) {
        toast.error("Un produit avec ce code-barres existe déjà");
      } else if (error.message.includes("idx_products_v2_establishment_code_produit")) {
        toast.error("Un produit avec ce code produit existe déjà");
      } else if (error.message.includes("idx_products_v2_establishment_name_normalized")) {
        toast.error("Un produit avec ce nom existe déjà");
      } else if (error.message.includes("Fournisseur obligatoire")) {
        toast.error("Veuillez sélectionner un fournisseur");
      } else {
        toast.error("Erreur lors de la création du produit");
      }
    },
  });

  // UPDATE — supplier_id SSOT
  const update = useMutation({
    mutationFn: async ({ id, formData }: { id: string; formData: ProductV2FormData }) => {
      if (!formData.supplier_id) {
        throw new Error("Fournisseur obligatoire");
      }

      if (!formData.storage_zone_id?.trim()) {
        throw new Error("Zone de stockage obligatoire");
      }

      return updateProductV2(id, {
        code_produit: formData.code_produit.trim() || null,
        code_barres: formData.code_barres.trim() || null,
        nom_produit: formData.nom_produit.trim(),
        nom_produit_fr: formData.nom_produit_fr.trim() || null,
        name_normalized: normalizeProductNameV2(formData.nom_produit),
        variant_format: formData.variant_format.trim() || null,
        // category text intentionally omitted — SSOT is category_id
        category_id: formData.category_id?.trim() || null,
        supplier_id: formData.supplier_id, // SSOT
        supplier_billing_unit_id: formData.supplier_billing_unit_id?.trim() || null,
        storage_zone_id: formData.storage_zone_id?.trim() || null,
        conditionnement_config: formData.conditionnement_config,
        conditionnement_resume: formData.conditionnement_resume.trim() || null,
        final_unit_price: formData.final_unit_price ? parseFloat(formData.final_unit_price) : null,
        final_unit_id: formData.final_unit_id?.trim() || null,
        stock_handling_unit_id: formData.stock_handling_unit_id?.trim() || null,
        kitchen_unit_id: formData.kitchen_unit_id?.trim() || null,
        delivery_unit_id: formData.delivery_unit_id?.trim() || null,
        price_display_unit_id: formData.price_display_unit_id?.trim() || null,
        info_produit: formData.info_produit.trim() || null,
      });
    },
    onSuccess: (data) => {
      invalidateProducts();
      queryClient.invalidateQueries({ queryKey: ["product-v2", data.id] });
      queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
      toast.success("Produit mis à jour");
    },
    onError: (error: Error) => {
      if (error.message.includes("STOCK_UNIT_LOCKED")) {
        toast.error("Impossible de modifier l'unité stock : le produit a encore du stock. Passez d'abord le stock à 0 via inventaire.");
      } else if (error.message.includes("OPTIMISTIC_LOCK_CONFLICT")) {
        toast.error("Ce produit a été modifié par un autre utilisateur. Veuillez rafraîchir la page et réessayer.");
      } else if (error.message.includes("idx_products_v2_establishment_barcode")) {
        toast.error("Un produit avec ce code-barres existe déjà");
      } else if (error.message.includes("idx_products_v2_establishment_code_produit")) {
        toast.error("Un produit avec ce code produit existe déjà");
      } else if (error.message.includes("idx_products_v2_establishment_name_normalized")) {
        toast.error("Un produit avec ce nom existe déjà");
      } else if (error.message.includes("Fournisseur obligatoire")) {
        toast.error("Veuillez sélectionner un fournisseur");
      } else {
        toast.error("Erreur lors de la mise à jour");
      }
    },
  });

  // UPSERT — For V3 Wizard integration
  // Auto-detects existing product by code_produit or name_normalized
  // Non-destructive: only updates provided fields
  const upsert = useMutation({
    mutationFn: async (payload: UpsertProductV2Payload): Promise<UpsertProductV2Result> => {
      if (!activeEstablishment?.id) {
        throw new Error("Aucun établissement sélectionné");
      }

      if (!payload.storage_zone_id?.trim()) {
        throw new Error("Zone de stockage obligatoire");
      }

      // Add created_by for new products
      const payloadWithUser: UpsertProductV2Payload = {
        ...payload,
        created_by: payload.created_by ?? user?.id ?? null,
      };

      return upsertProductV2(activeEstablishment.id, payloadWithUser);
    },
    onSuccess: (result) => {
      invalidateProducts();
      if (result.wasCreated) {
        toast.success("Produit enregistré");
      } else {
        toast.success(
          `Produit mis à jour (existant trouvé par ${result.matchedBy === "code_produit" ? "code produit" : "nom"})`
        );
      }
    },
    onError: (error: Error) => {
      if (import.meta.env.DEV) console.error("[ProductV2 Upsert Error]", error);
      if (error.message.includes("STOCK_UNIT_LOCKED")) {
        toast.error("Impossible de modifier l'unité stock : le produit a encore du stock. Passez d'abord le stock à 0 via inventaire.");
      } else if (error.message.includes("idx_products_v2")) {
        toast.error("Conflit: un produit similaire existe déjà");
      } else {
        toast.error("Erreur lors de l'enregistrement du produit");
      }
    },
  });

  // ARCHIVE (soft delete)
  const archive = useMutation({
    mutationFn: archiveProductV2,
    onSuccess: () => {
      invalidateProducts();
      queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
      toast.success("Produit archivé");
    },
    onError: () => {
      toast.error("Erreur lors de l'archivage");
    },
  });

  // PERMANENT DELETE (hard delete — removes product + all linked data)
  const permanentDelete = useMutation({
    mutationFn: deleteProductV2Permanently,
    onSuccess: () => {
      invalidateProducts();
      queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
      // Toast removed — silent success to avoid blocking mobile UI
    },
    onError: (error: Error) => {
      if (error.message.includes("référencé")) {
        toast.error(error.message);
      } else {
        toast.error("Impossible de supprimer ce produit : il est utilisé par des factures ou mouvements de stock.");
      }
    },
  });

  // COLLISION CHECK (pre-submit)
  const checkCollision = async (
    payload: { code_barres?: string; code_produit?: string; nom_produit: string },
    excludeId?: string
  ): Promise<CollisionCheckResult> => {
    if (!activeEstablishment?.id) {
      return {
        hasCollision: false,
        collisionType: null,
        existingProductId: null,
        existingProductName: null,
      };
    }
    return checkProductV2Collision(activeEstablishment.id, payload, excludeId);
  };

  return {
    create,
    update,
    upsert,
    archive,
    permanentDelete,
    checkCollision,
  };
}
