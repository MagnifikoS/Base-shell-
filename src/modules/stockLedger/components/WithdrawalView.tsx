/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WITHDRAWAL VIEW — Desktop Retrait (simplified: 2 motifs, no zone selection)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { ArrowDownRight, Plus, Send, AlertTriangle, Loader2, Factory, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useStorageZones } from "@/modules/produitsV2/hooks/useStorageZones";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { useWithdrawalDraft } from "../hooks/useWithdrawalDraft";
import { usePostDocument, type PostResult } from "../hooks/usePostDocument";
import { WithdrawalLineTable } from "./WithdrawalLineTable";
import { AddProductDialog } from "./AddProductDialog";
import { PostConfirmDialog } from "./PostConfirmDialog";
import { WITHDRAWAL_REASONS, type WithdrawalReasonCode } from "../constants/withdrawalReasons";
import { BlRetraitPostPopup } from "@/modules/blRetrait/components/BlRetraitPostPopup";
import { QuantityModalWithResolver as ReceptionQuantityModal } from "@/components/stock/QuantityModalWithResolver";
import { useProductCurrentStock } from "@/hooks/useProductCurrentStock";
import { useUnitConversions } from "@/core/unitConversion";
import { useProductInputConfigs } from "@/modules/inputConfig";
import { formatQuantityForContext } from "@/lib/units/formatQuantityForContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getInputPayloadProductName } from "../types";

const REASON_ICONS: Record<string, React.ElementType> = {
  CONSUMPTION: Factory,
  EXPIRY: Timer,
};

export function WithdrawalView() {
  const { zones } = useStorageZones();
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const estId = activeEstablishment?.id;
  const orgId = activeEstablishment?.organization_id;
  

  // ═══ PLACEHOLDER ZONE ═══
  // stock_documents.storage_zone_id is NOT NULL — we use any valid zone as a technical placeholder.
  // The REAL zone routing is done per-product in fn_post_stock_document (joins products_v2.storage_zone_id).
  // This field does NOT determine which zone the withdrawal affects.
  const defaultZoneId = zones.length > 0 ? zones[0].id : null;

  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  const [postError, setPostError] = useState<PostResult | null>(null);
  const [postGuard, setPostGuard] = useState(false);
  const [blRetraitDocId, setBlRetraitDocId] = useState<string | null>(null);

  const [reasonCode, setReasonCode] = useState<WithdrawalReasonCode | "">("");

  // Popup state for editing lines
  const [modalProduct, setModalProduct] = useState<{
    id: string;
    nom_produit: string;
    stock_handling_unit_id: string | null;
    final_unit_id: string | null;
    delivery_unit_id: string | null;
    supplier_billing_unit_id: string | null;
    conditionnement_config: Json | null;
    category: string | null;
  } | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const desktopWithdrawalStock = useProductCurrentStock(modalProduct?.id);

  const { document, lines, isLoading, isDraftCreating, draftError, ensureDraft, addLine, updateLine, removeLine } =
    useWithdrawalDraft(defaultZoneId);
  const { post, isPosting } = usePostDocument();
  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();
  const inputConfigs = useProductInputConfigs();
  const draftEnsured = useRef(false);

  // Load product data for existing draft lines (needed for popup edit)
  const lineProductIds = useMemo(() => lines.map((l) => l.product_id), [lines]);
  const { data: lineProducts = [] } = useQuery({
    queryKey: ["withdrawal-line-products-desktop", lineProductIds.join(",")],
    queryFn: async () => {
      if (lineProductIds.length === 0) return [];
      const { data } = await supabase
        .from("products_v2")
        .select(
          "id, nom_produit, category, storage_zone_id, final_unit_id, stock_handling_unit_id, supplier_billing_unit_id, delivery_unit_id, conditionnement_config"
        )
        .in("id", lineProductIds);
      return data ?? [];
    },
    enabled: lineProductIds.length > 0,
  });

  // Auto-create draft when zone is ready but no document exists
  useEffect(() => {
    if (!isLoading && !document && defaultZoneId && !draftEnsured.current) {
      draftEnsured.current = true;
      ensureDraft().then((result) => {
        if (!result.ok) {
          draftEnsured.current = false;
        }
      });
    }
    // Reset flag when zone changes
    if (!defaultZoneId) {
      draftEnsured.current = false;
    }
  }, [isLoading, document, defaultZoneId, ensureDraft]);

  const effectiveReason =
    WITHDRAWAL_REASONS.find((r) => r.value === reasonCode)?.label ?? "";

  const reasonValid = reasonCode !== "";

  // ═══ POST document ═══
  const handlePost = async () => {
    if (!document || postGuard) return;
    if (!reasonValid) {
      toast.error("Motif de retrait obligatoire.");
      return;
    }
    setPostGuard(true);
    setPostError(null);

    try {
      const result = await post({
        documentId: document.id,
        establishmentId: document.establishment_id,
        expectedLockVersion: document.lock_version,
        eventReason: effectiveReason,
      });

      if (result.ok) {
        toast.success(
          result.idempotent
            ? "Document déjà posté (idempotent)"
            : `Retrait posté — ${result.events_created} mouvement(s) enregistré(s)`
        );
        if (result.warnings && result.warnings.length > 0) {
          for (const w of result.warnings) {
            toast.warning(w, { duration: 8000 });
          }
        }
        setShowPostConfirm(false);
        // Reset draft guard so useEffect auto-creates a fresh draft
        draftEnsured.current = false;
        // Show BL Retrait popup
        setBlRetraitDocId(document.id);

        // STOCK ZERO V1: Discrepancy detection removed — backend clamps silently
      } else {
        setPostError(result);
        if (result.error === "LOCK_CONFLICT") {
          toast.error("Conflit : le document a été modifié. Rechargement…");
          setTimeout(() => {
            setShowPostConfirm(false);
            setPostError(null);
          }, 1500);
        } else if (result.error === "NO_ACTIVE_SNAPSHOT") {
          toast.error("Aucun inventaire de référence pour cette zone.");
        } else {
          toast.error(`Erreur : ${result.error}`);
        }
      }
    } finally {
      setPostGuard(false);
    }
  };

  const handleBlRetraitClose = () => {
    setBlRetraitDocId(null);
    setReasonCode("");
  };

  const editingLine = editingLineId ? lines.find((l) => l.id === editingLineId) : null;

  const handleModalConfirm = async (params: {
    productId: string;
    canonicalQuantity: number;
    canonicalUnitId: string;
    canonicalFamily: string;
    canonicalLabel: string | null;
  }) => {
    if (!editingLineId) return;
    await updateLine.mutateAsync({
      lineId: editingLineId,
      deltaQuantity: params.canonicalQuantity,
      inputPayload: {
        product_name: modalProduct?.nom_produit ?? params.productId,
        supplier_name: null,
      },
    });
    toast.success("Ligne mise à jour ✓");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ArrowDownRight className="h-5 w-5 text-destructive" />
        <h2 className="text-lg font-semibold">Retrait de stock</h2>
      </div>

      {/* Draft area */}
      {!defaultZoneId ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Aucune zone de stockage configurée.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !document ? (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          {draftError ? (
            <>
              <AlertTriangle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-destructive text-center font-medium">{draftError}</p>
              <Button variant="outline" size="sm" onClick={() => { draftEnsured.current = false; ensureDraft(); }}>
                Réessayer
              </Button>
            </>
          ) : isDraftCreating ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Création du brouillon…</span>
            </>
          ) : (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Préparation du brouillon…</span>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => { draftEnsured.current = false; ensureDraft(); }}>
                Forcer la création
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4 space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Motif du retrait *</p>
              <div className="flex items-center gap-3">
                {WITHDRAWAL_REASONS.map((r) => {
                  const IconComp = REASON_ICONS[r.value] ?? Factory;
                  const isActive = reasonCode === r.value;
                  return (
                    <button
                      key={r.value}
                      onClick={() => setReasonCode(r.value as WithdrawalReasonCode)}
                      className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all ${
                        isActive
                          ? "bg-primary/15 text-primary border border-primary/30"
                          : "bg-muted text-muted-foreground border border-transparent hover:bg-muted/80"
                      }`}
                    >
                      <IconComp className="h-4 w-4" />
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* DRAFT editor */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="whitespace-nowrap">
                v{document.lock_version}
              </Badge>
              {effectiveReason && (
                <Badge variant="secondary" className="whitespace-nowrap">
                  {effectiveReason}
                </Badge>
              )}
            </div>

            <WithdrawalLineTable
              lines={lines}
              displayLabels={(() => {
                const map = new Map<string, string>();
                for (const line of lines) {
                  const product = lineProducts.find((p) => p.id === line.product_id);
                  if (!product) continue;
                  const label = formatQuantityForContext(
                    Math.abs(line.delta_quantity_canonical),
                    product,
                    "internal",
                    inputConfigs.get(line.product_id) ?? null,
                    dbUnits,
                    dbConversions,
                  );
                  if (label) map.set(line.id, label);
                }
                return map;
              })()}
              onEditLine={(lineId) => {
                const line = lines.find((l) => l.id === lineId);
                if (!line) return;
                const product = lineProducts.find((p) => p.id === line.product_id);
                if (product) {
                  setModalProduct(product);
                  setEditingLineId(lineId);
                }
              }}
              onRemove={(lineId) => removeLine.mutate(lineId)}
            />

            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setShowAddProduct(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Ajouter un produit
              </Button>

              <div className="flex-1" />


              <Button
                onClick={() => setShowPostConfirm(true)}
                disabled={lines.length === 0 || isPosting || postGuard || !reasonValid}
                className="min-w-[160px]"
                variant="destructive"
              >
                {isPosting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Poster le retrait
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add product dialog - uses defaultZoneId but shows all products */}
      {document && defaultZoneId && (
        <AddProductDialog
          open={showAddProduct}
          onClose={() => setShowAddProduct(false)}
          zoneId={defaultZoneId}
          documentId={document.id}
          existingProductIds={lines.map((l) => l.product_id)}
          onAdd={async (params) => {
            await addLine.mutateAsync(params);
            toast.success("Produit ajouté");
          }}
        />
      )}

      {/* Post confirmation dialog */}
      {document && (
        <PostConfirmDialog
          open={showPostConfirm}
          onClose={() => {
            setShowPostConfirm(false);
            setPostError(null);
          }}
          linesCount={lines.length}
          zoneName="Retrait"
          isPosting={isPosting}
          postError={postError}
          onConfirm={() => handlePost()}
        />
      )}

      {/* BL Retrait popup after POST */}
      {blRetraitDocId && estId && orgId && (
        <BlRetraitPostPopup
          open={!!blRetraitDocId}
          onClose={handleBlRetraitClose}
          stockDocumentId={blRetraitDocId}
          establishmentId={estId}
          organizationId={orgId}
        />
      )}

      {/* Quantity popup for editing lines */}
      <ReceptionQuantityModal
        open={!!modalProduct}
        onClose={() => {
          setModalProduct(null);
          setEditingLineId(null);
        }}
        product={modalProduct}
        dbUnits={dbUnits}
        dbConversions={dbConversions}
        onConfirm={handleModalConfirm}
        existingQuantity={editingLine ? Math.abs(editingLine.delta_quantity_canonical) : undefined}
        contextLabel="Retrait"
        contextType="withdrawal"
        currentStockCanonical={desktopWithdrawalStock.currentStockCanonical}
        currentStockUnitLabel={desktopWithdrawalStock.currentStockUnitLabel}
        currentStockLoading={desktopWithdrawalStock.isLoading}
      />
    </div>
  );
}
