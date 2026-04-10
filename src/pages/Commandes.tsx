/**
 * Commandes Route Page — Product orders only.
 *
 * Composition pattern:
 * - Data: useUnifiedCommandes (page-level, product commandes)
 * - List: UnifiedCommandesList (page-level, product cards)
 * - New: NouvelleCommandeCompositeDialog (page-level, product create flow)
 * - Dialogs: lazy-imported from commandes module
 *
 * Zero modification to src/modules/commandes/.
 */

import { useState, useCallback, useMemo, lazy, Suspense } from "react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { ResumeOrNewDraftDialog } from "@/modules/commandes/components/ResumeOrNewDraftDialog";
import { useActiveDraft, useDeleteDraftCommande, useCreateDraftCommande, useUpsertCommandeLines } from "@/modules/commandes/hooks/useCommandes";
import { useEstablishmentNames } from "@/modules/commandes/hooks/useEstablishmentNames";
import { UnifiedCommandesList } from "./commandes/UnifiedCommandesList";
import { useUnifiedCommandes } from "./commandes/useUnifiedCommandes";
import { NouvelleCommandeCompositeDialog } from "./commandes/NouvelleCommandeCompositeDialog";
import type { UnifiedItem, ProductCommandeResolved } from "./commandes/useUnifiedCommandes";
import type { Commande } from "@/modules/commandes/types";

// ── Product dialogs (lazy) ──
const CommandeDetailDialog = lazy(() =>
  import("@/modules/commandes/components/CommandeDetailDialog").then((m) => ({ default: m.CommandeDetailDialog }))
);
const PreparationDialog = lazy(() =>
  import("@/modules/commandes/components/PreparationDialog").then((m) => ({ default: m.PreparationDialog }))
);
const ReceptionDialog = lazy(() =>
  import("@/modules/commandes/components/ReceptionDialog").then((m) => ({ default: m.ReceptionDialog }))
);
const LitigeDetailDialog = lazy(() =>
  import("@/modules/litiges/components/LitigeDetailDialog").then((m) => ({ default: m.LitigeDetailDialog }))
);

function toCommande(resolved: ProductCommandeResolved): Commande {
  return resolved;
}

export default function Commandes() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  // ── New order ──
  const [showNewComposite, setShowNewComposite] = useState(false);
  const [resumeProductDraft, setResumeProductDraft] = useState<ProductCommandeResolved | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);

  // ── Product view state ──
  const [selectedProduct, setSelectedProduct] = useState<ProductCommandeResolved | null>(null);
  const [preparationProduct, setPreparationProduct] = useState<ProductCommandeResolved | null>(null);
  const [receptionProduct, setReceptionProduct] = useState<ProductCommandeResolved | null>(null);
  const [litigeProduct, setLitigeProduct] = useState<ProductCommandeResolved | null>(null);

  const { data: activeDraft, refetch: refetchDraft } = useActiveDraft();
  const deleteDraft = useDeleteDraftCommande();
  const createDraft = useCreateDraftCommande();
  const upsertLines = useUpsertCommandeLines();

  // Establishment names
  const { items } = useUnifiedCommandes();
  const partnerEstIds = useMemo(() => {
    const ids = new Set<string>();
    for (const i of items) {
      ids.add(i.data.client_establishment_id);
      ids.add(i.data.supplier_establishment_id);
    }
    return [...ids];
  }, [items]);
  const { data: establishmentNames = {} } = useEstablishmentNames(partnerEstIds);

  // ── New commande ──
  const handleNewCommande = useCallback(async () => {
    const { data: draft } = await refetchDraft();
    if (draft) {
      setResumeProductDraft(draft as ProductCommandeResolved);
      setShowResumePrompt(true);
    } else {
      setResumeProductDraft(null);
      setShowNewComposite(true);
    }
  }, [refetchDraft]);

  const handleResume = useCallback(() => {
    setShowResumePrompt(false);
    setShowNewComposite(true);
  }, []);

  const handleNewFromScratch = useCallback(async () => {
    if (resumeProductDraft) {
      try { await deleteDraft.mutateAsync(resumeProductDraft.id); } catch { /* ignore */ }
    }
    setShowResumePrompt(false);
    setResumeProductDraft(null);
    setShowNewComposite(true);
  }, [resumeProductDraft, deleteDraft]);

  // ── Reorder missing products after reception ──
  const handleReorderMissing = useCallback(async (
    sourceCommande: Commande,
    missingLines: Array<{ productId: string; productName: string; missingQty: number; canonicalUnitId: string; unitLabel: string | null }>
  ) => {
    try {
      const { toast } = await import("sonner");
      const draft = await createDraft.mutateAsync({
        supplierEstablishmentId: sourceCommande.supplier_establishment_id,
        partnershipId: sourceCommande.partnership_id,
        sourceCommandeId: sourceCommande.id,
      });
      await upsertLines.mutateAsync({
        commandeId: draft.id,
        items: missingLines.map((l) => ({
          productId: l.productId,
          productName: l.productName,
          canonicalQuantity: l.missingQty,
          canonicalUnitId: l.canonicalUnitId,
          canonicalUnitLabel: l.unitLabel,
        })),
      });
      toast.success("Brouillon de commande créé à partir des produits manquants");
    } catch {
      const { toast } = await import("sonner");
      toast.error("Erreur lors de la création du brouillon de complément");
    }
  }, [createDraft, upsertLines]);

  // ── Click handler ──
  const handleViewItem = useCallback(
    (item: UnifiedItem) => {
      const isSender = item.data.client_establishment_id === estId;
      const isReceiver = item.data.supplier_establishment_id === estId;
      const c = item.data;

      if (c.status === "brouillon" && isSender) {
        setResumeProductDraft(c);
        setShowNewComposite(true);
        return;
      }
      if ((c.status === "envoyee" || c.status === "ouverte") && isReceiver) {
        setPreparationProduct(c);
        return;
      }
      if (c.status === "expediee" && isSender) {
        setReceptionProduct(c);
        return;
      }
      if (c.status === "litige") {
        setLitigeProduct(c);
        return;
      }
      setSelectedProduct(c);
    },
    [estId]
  );

  return (
    <ResponsiveLayout>
      <div className="container mx-auto py-4 sm:py-6 px-3 sm:px-4 max-w-6xl">
        <UnifiedCommandesList
          onNewCommande={handleNewCommande}
          onViewItem={handleViewItem}
          establishmentNames={establishmentNames}
        />

        {/* ── New order dialog ── */}
        {showNewComposite && (
          <NouvelleCommandeCompositeDialog
            open={showNewComposite}
            onClose={() => { setShowNewComposite(false); setResumeProductDraft(null); }}
            resumeProductDraft={resumeProductDraft ? toCommande(resumeProductDraft) : null}
          />
        )}

        <Suspense fallback={null}>
          {/* ── Product dialogs ── */}
          {selectedProduct && (
            <CommandeDetailDialog
              open={!!selectedProduct}
              onClose={() => setSelectedProduct(null)}
              commande={toCommande(selectedProduct)}
              establishmentNames={establishmentNames}
            />
          )}
          {preparationProduct && (
            <PreparationDialog
              open={!!preparationProduct}
              onClose={() => setPreparationProduct(null)}
              commande={toCommande(preparationProduct)}
              establishmentNames={establishmentNames}
            />
          )}
          {receptionProduct && (
            <ReceptionDialog
              open={!!receptionProduct}
              onClose={() => setReceptionProduct(null)}
              commande={toCommande(receptionProduct)}
              establishmentNames={establishmentNames}
              onReorderMissing={handleReorderMissing}
            />
          )}
          {litigeProduct && (
            <LitigeDetailDialog
              open={!!litigeProduct}
              onClose={() => setLitigeProduct(null)}
              commande={toCommande(litigeProduct)}
              establishmentNames={establishmentNames}
            />
          )}
        </Suspense>

        <ResumeOrNewDraftDialog
          open={showResumePrompt}
          onClose={() => setShowResumePrompt(false)}
          onResume={handleResume}
          onNewFromScratch={handleNewFromScratch}
          supplierName={resumeProductDraft ? (establishmentNames[resumeProductDraft.supplier_establishment_id] || "Fournisseur") : ""}
        />
      </div>
    </ResponsiveLayout>
  );
}
