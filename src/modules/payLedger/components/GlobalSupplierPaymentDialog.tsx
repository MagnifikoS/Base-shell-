/**
 * GlobalSupplierPaymentDialog — Paiement global fournisseur + allocation FIFO mensuel strict
 * Affiche :
 *   - Crédit fournisseur actuel (computed via engine)
 *   - Crédit estimé après paiement (si surpaiement vs dettes du mois)
 */

import { useState } from "react";
import { toast } from "sonner";
import { Zap, TrendingUp } from "lucide-react";
import { formatParisDateKey } from "@/lib/time/dateKeyParis";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useSupplierGlobalPayment, useSupplierCredit } from "../hooks/usePayLedger";
import { formatEurPay } from "../engine/payEngine";
import type { PaymentMethod } from "../types";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "virement",    label: "Virement" },
  { value: "prelevement", label: "Prélèvement" },
  { value: "carte",       label: "Carte" },
  { value: "espece",      label: "Espèces" },
  { value: "autre",       label: "Autre" },
];

interface GlobalSupplierPaymentDialogProps {
  open:            boolean;
  onClose:         () => void;
  organizationId:  string;
  establishmentId: string;
  supplierId:      string;
  supplierName:    string;
  yearMonth:       string;
  /** Total remaining du mois pour ce fournisseur */
  monthRemaining?: number;
  defaultAmount?:  number;
}

export function GlobalSupplierPaymentDialog({
  open,
  onClose,
  organizationId,
  establishmentId,
  supplierId,
  supplierName,
  yearMonth,
  monthRemaining = 0,
  defaultAmount,
}: GlobalSupplierPaymentDialogProps) {
  const today = formatParisDateKey(new Date());

  const [amount, setAmount] = useState(defaultAmount != null ? String(defaultAmount.toFixed(2)) : "");
  const [date,   setDate]   = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("virement");
  const [note,   setNote]   = useState("");

  const mutation = useSupplierGlobalPayment(establishmentId, yearMonth);

  // Crédit actuel du fournisseur (scope global)
  const { data: creditData } = useSupplierCredit(establishmentId, supplierId);
  const currentCredit = creditData?.credit ?? 0;

  // Crédit estimé après ce paiement
  const amountNum    = parseFloat(amount) || 0;
  const surplus      = Math.max(0, amountNum - monthRemaining);
  const estimatedCredit = Math.round((currentCredit + surplus) * 100) / 100;

  const handleSubmit = async () => {
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Montant invalide");
      return;
    }
    try {
      const result = await mutation.mutateAsync({
        organization_id: organizationId,
        supplier_id:     supplierId,
        payment_date:    date,
        amount_eur:      amountNum,
        method,
        note:            note.trim() || null,
      });

      if (result.invoiceCount > 0) {
        toast.success(
          `Paiement créé — ${result.invoiceCount} facture(s) · ${formatEurPay(result.allocated)} alloué(s)` +
          (result.creditLeft > 0 ? ` · Crédit fournisseur : ${formatEurPay(result.creditLeft + currentCredit)}` : "")
        );
      } else {
        toast.success(
          `Paiement créé · Crédit fournisseur : ${formatEurPay(currentCredit + amountNum)}`
        );
      }

      setAmount("");
      setNote("");
      setDate(today);
      onClose();
    } catch {
      toast.error("Erreur lors de l'enregistrement");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Paiement fournisseur global
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {supplierName}
          </p>
          {monthRemaining > 0 && (
            <p className="text-xs text-muted-foreground">
              Reste du mois : <span className="font-semibold">{formatEurPay(monthRemaining)}</span>
            </p>
          )}
          {currentCredit > 0 && (
            <div className="flex items-center gap-1.5 mt-1 text-xs text-primary">
              <TrendingUp className="h-3 w-3" />
              Crédit actuel : <span className="font-semibold">{formatEurPay(currentCredit)}</span>
            </div>
          )}
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="gs-amount">Montant (€)</Label>
            <Input
              id="gs-amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amountNum > 0 && surplus > 0.005 && (
              <p className="text-xs text-muted-foreground">
                ⚠️ Surpaiement de {formatEurPay(surplus)} — crédit après paiement : <span className="font-semibold">{formatEurPay(estimatedCredit)}</span>
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="gs-date">Date de paiement</Label>
            <Input
              id="gs-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label>Méthode</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="gs-note">Note (optionnel)</Label>
            <Input
              id="gs-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Référence virement, commentaire..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending || !amount || parseFloat(amount) <= 0}
          >
            {mutation.isPending ? "Enregistrement..." : "Enregistrer + Allouer FIFO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
