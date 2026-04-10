/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BL RETRAIT — Post Popup (Atomic RPC version)
 * Shown after a successful withdrawal POST to generate a BL Retrait.
 *
 * Uses fn_create_bl_withdrawal RPC (single PG transaction):
 *   - Generates BL number atomically
 *   - Creates document + lines in one call
 *   - Idempotent (safe on double-click)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { Loader2, Check, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onClose: () => void;
  stockDocumentId: string;
  establishmentId: string;
  organizationId: string;
}

/**
 * Fetches stock_document_lines + product info, then calls the atomic RPC.
 */
async function createBlRetraitAtomic(params: {
  establishmentId: string;
  organizationId: string;
  stockDocumentId: string;
  destinationEstablishmentId: string;
  destinationName: string | null;
  createdBy: string;
}): Promise<{ id: string; bl_number: string }> {
  // 1. Fetch lines from posted stock document
  const { data: stockLines, error: linesErr } = await supabase
    .from("stock_document_lines")
    .select("product_id, delta_quantity_canonical, canonical_unit_id, input_payload")
    .eq("document_id", params.stockDocumentId);

  if (linesErr) throw linesErr;
  if (!stockLines || stockLines.length === 0) throw new Error("Aucune ligne trouvée pour ce document");

  // 2. Fetch product prices + names for snapshots
  const productIds = [...new Set(stockLines.map((l) => l.product_id))];
  const { data: products, error: prodErr } = await supabase
    .from("products_v2")
    .select("id, nom_produit, final_unit_price")
    .in("id", productIds);
  if (prodErr) throw prodErr;

  const productMap = new Map((products ?? []).map((p) => [p.id, p]));

  // 3. Build lines JSONB for the RPC
  const linesJson = stockLines.map((sl) => {
    const product = productMap.get(sl.product_id);
    return {
      product_id: sl.product_id,
      product_name_snapshot: String(
        product?.nom_produit ??
        (sl.input_payload as Record<string, unknown>)?.product_name ??
        sl.product_id),
      quantity: Math.abs(sl.delta_quantity_canonical),
      canonical_unit_id: sl.canonical_unit_id || null,
      unit_price: product?.final_unit_price ?? null,
    };
  });

  // 4. Call atomic RPC
  const { data, error } = await supabase.rpc("fn_create_bl_withdrawal", {
    p_establishment_id: params.establishmentId,
    p_organization_id: params.organizationId,
    p_stock_document_id: params.stockDocumentId,
    p_destination_establishment_id: params.destinationEstablishmentId,
    p_destination_name: params.destinationName,
    p_created_by: params.createdBy,
    p_lines: linesJson,
  });

  if (error) throw error;

  const result = data as Record<string, unknown> | null;
  if (!result?.ok) {
    throw new Error((result?.error as string) ?? "Échec création du bon de sortie");
  }

  return {
    id: result.id as string,
    bl_number: result.bl_number as string,
  };
}

export function BlRetraitPostPopup({
  open,
  onClose,
  stockDocumentId,
  establishmentId,
  organizationId,
}: Props) {
  const { user } = useAuth();
  const { establishments } = useEstablishment();
  const queryClient = useQueryClient();

  const [destinationEstId, setDestinationEstId] = useState("");
  const [createdBlNumber, setCreatedBlNumber] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: createBlRetraitAtomic,
    onSuccess: (result) => {
      setCreatedBlNumber(result.bl_number);
      queryClient.invalidateQueries({ queryKey: ["bl-retraits"] });
      queryClient.invalidateQueries({ queryKey: ["bl-withdrawal-documents"] });
      queryClient.invalidateQueries({ queryKey: ["bl-retrait-documents"] });
      toast.success(`Bon de sortie ${result.bl_number} créé ✓`);
    },
    onError: (err: Error) => {
      toast.error("Erreur : " + (err.message ?? "inconnue"));
    },
  });

  const handleConfirm = () => {
    if (!destinationEstId || !user?.id) return;

    const destEst = establishments.find((e) => e.id === destinationEstId);

    mutation.mutate({
      establishmentId,
      organizationId,
      stockDocumentId,
      destinationEstablishmentId: destinationEstId,
      destinationName: destEst?.name ?? null,
      createdBy: user.id,
    });
  };

  const handleClose = () => {
    setCreatedBlNumber(null);
    setDestinationEstId("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Bon de sortie
          </DialogTitle>
        </DialogHeader>

        {createdBlNumber ? (
          /* ── Success state ── */
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Check className="h-6 w-6 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Bon de sortie créé</p>
              <p className="font-mono font-semibold text-lg">{createdBlNumber}</p>
            </div>
            <Button onClick={handleClose} className="w-full">
              Fermer
            </Button>
          </div>
        ) : (
          /* ── Form state ── */
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Établissement destinataire</Label>
                <Select value={destinationEstId} onValueChange={setDestinationEstId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionnez..." />
                  </SelectTrigger>
                  <SelectContent>
                    {establishments.map((est) => (
                      <SelectItem key={est.id} value={est.id}>
                        {est.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose}>
                Annuler
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!destinationEstId || mutation.isPending}
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Valider
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
