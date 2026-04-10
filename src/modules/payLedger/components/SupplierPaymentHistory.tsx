/**
 * SupplierPaymentHistory — Historique chronologique des paiements d'un fournisseur
 * - Timeline des paiements (tous, y compris voidés)
 * - Void possible
 * - Crédit fournisseur réel = Σ paiements non-voidés − Σ allocations non-voidées
 */

import { useState } from "react";
import { Ban, Check, X, AlertCircle, History, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupplierCredit, useVoidPayment } from "../hooks/usePayLedger";
import { formatEurPay } from "../engine/payEngine";
import type { PayPayment } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Inline void form
// ─────────────────────────────────────────────────────────────────────────────

function VoidConfirmInline({
  paymentId,
  establishmentId,
  yearMonth,
  onDone,
}: {
  paymentId:       string;
  establishmentId: string;
  yearMonth:       string;
  onDone:          () => void;
}) {
  const [reason, setReason] = useState("");
  const mutation = useVoidPayment(establishmentId, yearMonth);

  const handleVoid = async () => {
    if (!reason.trim()) { toast.error("Raison obligatoire"); return; }
    try {
      await mutation.mutateAsync({ paymentId, reason: reason.trim() });
      toast.success("Paiement annulé");
      onDone();
    } catch {
      toast.error("Erreur lors de l'annulation");
    }
  };

  return (
    <div className="mt-2 p-3 rounded-lg border border-destructive/30 bg-destructive/5 space-y-2">
      <Label className="text-xs">Raison de l'annulation</Label>
      <Input
        className="h-8 text-sm"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Ex: doublon, erreur de montant..."
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          className="h-7 text-xs"
          onClick={handleVoid}
          disabled={mutation.isPending || !reason.trim()}
        >
          {mutation.isPending ? "Annulation..." : "Confirmer"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Method label
// ─────────────────────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  virement:    "Virement",
  prelevement: "Prélèvement",
  carte:       "Carte",
  espece:      "Espèces",
  autre:       "Autre",
};

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface SupplierPaymentHistoryProps {
  establishmentId: string;
  supplierId:      string;
  yearMonth:       string; // pour l'invalidation cache sur void
}

export function SupplierPaymentHistory({
  establishmentId,
  supplierId,
  yearMonth,
}: SupplierPaymentHistoryProps) {
  const [voidingPaymentId, setVoidingPaymentId] = useState<string | null>(null);

  const { data, isLoading } = useSupplierCredit(establishmentId, supplierId);
  const payments   = data?.payments   ?? [];
  const credit     = data?.credit     ?? 0;

  if (isLoading) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground animate-pulse">
        Chargement de l'historique...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── KPI crédit fournisseur réel ─── */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
        <TrendingUp className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">Crédit fournisseur</p>
          <p className={`text-lg font-bold tabular-nums ${credit > 0 ? "text-foreground" : "text-muted-foreground"}`}>
            {formatEurPay(credit)}
          </p>
          <p className="text-xs text-muted-foreground">
            Paiements non-voidés − allocations
          </p>
        </div>
        <Badge variant={credit > 0 ? "default" : "secondary"} className="shrink-0">
          {payments.length} paiement{payments.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* ─── Timeline ─── */}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
          <History className="h-3.5 w-3.5" />
          Historique chronologique
        </p>

        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucun paiement enregistré pour ce fournisseur.
          </p>
        ) : (
          <div className="space-y-1.5">
            {payments.map((payment: PayPayment) => {
              const isVoided  = !!payment.voided_at;
              const isVoiding = voidingPaymentId === payment.id;

              return (
                <div
                  key={payment.id}
                  className={`rounded-lg border p-3 space-y-1.5 transition-opacity ${
                    isVoided ? "opacity-50 bg-muted/50" : "bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {isVoided ? (
                        <X className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <Check className="h-4 w-4 text-foreground shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium tabular-nums">
                          {formatEurPay(payment.amount_eur)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {payment.payment_date} · {METHOD_LABELS[payment.method] ?? payment.method}
                          {payment.payment_source === "auto" && (
                            <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">auto</Badge>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isVoided ? (
                        <Badge className="text-[10px] bg-muted text-muted-foreground">Annulé</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setVoidingPaymentId(isVoiding ? null : payment.id)}
                          title="Annuler ce paiement"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {payment.note && (
                    <p className="text-xs text-muted-foreground pl-6">{payment.note}</p>
                  )}

                  {isVoided && payment.void_reason && (
                    <p className="text-xs text-muted-foreground pl-6 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      Motif : {payment.void_reason}
                    </p>
                  )}

                  {isVoiding && (
                    <VoidConfirmInline
                      paymentId={payment.id}
                      establishmentId={establishmentId}
                      yearMonth={yearMonth}
                      onDone={() => setVoidingPaymentId(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
