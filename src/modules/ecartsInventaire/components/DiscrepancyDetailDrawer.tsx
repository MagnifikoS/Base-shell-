/**
 * ═══════════════════════════════════════════════════════════════
 * DiscrepancyDetailDrawer — Detail + investigation panel
 * ═══════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  AlertTriangle,
  PackageCheck,
  PackageMinus,
  ClipboardList,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useDiscrepancyInvestigation } from "../hooks/useDiscrepancyInvestigation";
import { updateDiscrepancyStatus } from "../services/discrepancyService";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { DiscrepancyWithDetails, DiscrepancyStatus } from "../types";

interface Props {
  discrepancy: DiscrepancyWithDetails | null;
  onClose: () => void;
}

export function DiscrepancyDetailDrawer({ discrepancy, onClose }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: investigation, isLoading: invLoading } =
    useDiscrepancyInvestigation(discrepancy);

  const [status, setStatus] = useState<DiscrepancyStatus>(
    discrepancy?.status ?? "open"
  );
  const [note, setNote] = useState(discrepancy?.resolution_note ?? "");
  const [saving, setSaving] = useState(false);

  // Reset state when discrepancy changes
  const currentId = discrepancy?.id;
  const [lastId, setLastId] = useState<string | null>(null);
  if (currentId && currentId !== lastId) {
    setLastId(currentId);
    setStatus(discrepancy?.status ?? "open");
    setNote(discrepancy?.resolution_note ?? "");
  }

  const handleSave = async () => {
    if (!discrepancy) return;
    setSaving(true);
    const { error } = await updateDiscrepancyStatus(
      discrepancy.id,
      status,
      note || null,
      user?.id ?? null
    );
    setSaving(false);
    if (error) {
      toast.error("Erreur lors de la mise à jour");
    } else {
      toast.success("Écart mis à jour");
      queryClient.invalidateQueries({ queryKey: ["inventory-discrepancies"] });
      onClose();
    }
  };

  const fmtDate = (d: string | null) =>
    d ? format(new Date(d), "dd/MM/yyyy HH:mm", { locale: fr }) : "—";

  return (
    <Sheet open={!!discrepancy} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Détail de l'écart
          </SheetTitle>
        </SheetHeader>

        {discrepancy && (
          <div className="space-y-6 mt-4">
            {/* ═══ Bloc 1: Ce qui s'est passé ═══ */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Ce qui s'est passé
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Produit</p>
                  <p className="font-medium">{discrepancy.product_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Zone</p>
                  <p className="font-medium">{discrepancy.zone_name ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Stock théorique</p>
                  <p className="font-medium">
                    {discrepancy.estimated_stock_before}{" "}
                    {discrepancy.unit_label ?? ""}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Quantité retirée</p>
                  <p className="font-medium">
                    {discrepancy.withdrawal_quantity}{" "}
                    {discrepancy.unit_label ?? ""}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Écart</p>
                  <p className="font-medium text-destructive">
                    {discrepancy.gap_quantity} {discrepancy.unit_label ?? ""}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Date / Heure</p>
                  <p className="font-medium">
                    {fmtDate(discrepancy.withdrawn_at)}
                  </p>
                </div>
                {discrepancy.withdrawal_reason && (
                  <div>
                    <p className="text-muted-foreground">Motif</p>
                    <p className="font-medium">
                      {discrepancy.withdrawal_reason}
                    </p>
                  </div>
                )}
              </div>
            </section>

            <Separator />

            {/* ═══ Bloc 2: Mini enquête ═══ */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Mini enquête
              </h3>

              {invLoading ? (
                <div className="flex items-center gap-2 py-4 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Chargement…
                </div>
              ) : investigation ? (
                <div className="space-y-3">
                  {/* Last receipt */}
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <PackageCheck className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">Dernière réception</p>
                      {investigation.lastReceipt ? (
                        <p className="text-muted-foreground">
                          {investigation.lastReceipt.quantity} {discrepancy?.unit_label ?? "—"} —{" "}
                          {fmtDate(investigation.lastReceipt.date)}
                          {investigation.lastReceipt.daysAgo !== null &&
                            ` (il y a ${investigation.lastReceipt.daysAgo}j)`}
                        </p>
                      ) : (
                        <p className="text-muted-foreground">Aucune réception trouvée</p>
                      )}
                    </div>
                  </div>

                  {/* Last withdrawal */}
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <PackageMinus className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">Dernier retrait (avant cet écart)</p>
                      {investigation.lastWithdrawal ? (
                        <p className="text-muted-foreground">
                          {investigation.lastWithdrawal.quantity} {discrepancy?.unit_label ?? "—"} —{" "}
                          {fmtDate(investigation.lastWithdrawal.date)}
                          {investigation.lastWithdrawal.daysAgo !== null &&
                            ` (il y a ${investigation.lastWithdrawal.daysAgo}j)`}
                        </p>
                      ) : (
                        <p className="text-muted-foreground">Aucun retrait trouvé</p>
                      )}
                    </div>
                  </div>

                  {/* Last inventory */}
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <ClipboardList className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">Dernier inventaire</p>
                      {investigation.lastInventory ? (
                        <p className="text-muted-foreground">
                          {investigation.lastInventory.quantityCounted} comptés —{" "}
                          {fmtDate(investigation.lastInventory.date)}
                          {investigation.lastInventory.daysAgo !== null &&
                            ` (il y a ${investigation.lastInventory.daysAgo}j)`}
                        </p>
                      ) : (
                        <p className="text-muted-foreground">Aucun inventaire trouvé</p>
                      )}
                    </div>
                  </div>

                  {/* Recurrence indicator */}
                  {investigation.isRecurrent && (
                    <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg">
                      <RefreshCw className="h-4 w-4 text-destructive" />
                      <p className="text-sm font-medium text-destructive">
                        Écart récurrent — {investigation.totalDiscrepancies} écarts
                        pour ce produit
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            <Separator />

            {/* ═══ Bloc 3: Gestion ═══ */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Gestion
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">
                    Statut
                  </label>
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as DiscrepancyStatus)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Ouvert</SelectItem>
                      <SelectItem value="analyzed">Analysé</SelectItem>
                      <SelectItem value="closed">Clos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">
                    Note de résolution
                  </label>
                  <Textarea
                    placeholder="Ex: réception oubliée le 05/03, corrigé"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Enregistrer
                </Button>
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
