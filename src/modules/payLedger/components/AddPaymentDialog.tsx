/**
 * AddPaymentDialog — Paiement direct facture
 * - Surpaiement AUTORISÉ (amount > remaining → surplus = crédit fournisseur)
 * - Utilise useCreatePaymentWithAllocation (SSOT unique)
 */

import { useState } from "react";
import { toast } from "sonner";
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
import { useCreatePaymentWithAllocation } from "../hooks/usePayLedger";
import { formatEurPay } from "../engine/payEngine";
import type { PaymentMethod } from "../types";

interface AddPaymentDialogProps {
  open:            boolean;
  onClose:         () => void;
  organizationId:  string;
  establishmentId: string;
  supplierId:      string;
  payInvoiceId:    string;
  yearMonth:       string;
  remaining:       number;
  supplierName:    string;
  invoiceLabel:    string | null;
  /** false = montant forcé = reste, input locked */
  allowPartial?:   boolean;
  /** Méthode pré-sélectionnée */
  defaultMethod?:  PaymentMethod;
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "virement",    label: "Virement" },
  { value: "prelevement", label: "Prélèvement" },
  { value: "carte",       label: "Carte" },
  { value: "espece",      label: "Espèces" },
  { value: "autre",       label: "Autre" },
];

export function AddPaymentDialog({
  open,
  onClose,
  organizationId,
  establishmentId,
  supplierId,
  payInvoiceId,
  yearMonth,
  remaining,
  supplierName,
  invoiceLabel,
  allowPartial = true,
  defaultMethod,
}: AddPaymentDialogProps) {
  const today = formatParisDateKey(new Date());
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const [date,   setDate]   = useState(today);
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod ?? "virement");
  const [note,   setNote]   = useState("");

  const mutation = useCreatePaymentWithAllocation(establishmentId, yearMonth);

  const handleSubmit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Montant invalide");
      return;
    }
    // Surpaiement autorisé — le surplus devient crédit fournisseur
    const isSurpayment = amountNum > remaining + 0.005;

    try {
      await mutation.mutateAsync({
        organization_id: organizationId,
        supplier_id:     supplierId,
        pay_invoice_id:  payInvoiceId,
        payment_date:    date,
        amount_eur:      amountNum,
        method,
        note:            note.trim() || null,
      });

      if (isSurpayment) {
        const credit = amountNum - remaining;
        toast.success(`Paiement enregistré · Crédit fournisseur : ${formatEurPay(credit)}`);
      } else {
        toast.success("Paiement enregistré");
      }
      onClose();
    } catch (err) {
      toast.error("Erreur lors de l'enregistrement");
      console.error(err);
    }
  };

  const amountNum     = parseFloat(amount);
  const isSurpayment  = !isNaN(amountNum) && amountNum > remaining + 0.005;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter un paiement</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {supplierName}{invoiceLabel ? ` — ${invoiceLabel}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Reste à payer : <span className="font-semibold">{formatEurPay(remaining)}</span>
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="pay-amount">Montant (€)</Label>
            <Input
              id="pay-amount"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!allowPartial}
            />
            {!allowPartial && (
              <p className="text-xs text-muted-foreground">
                Paiement total obligatoire selon règle fournisseur.
              </p>
            )}
            {isSurpayment && (
              <p className="text-xs text-orange-600 dark:text-orange-400">
                ⚠️ Surpaiement de {formatEurPay(amountNum - remaining)} — le surplus sera comptabilisé comme crédit fournisseur.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="pay-date">Date de paiement</Label>
            <Input
              id="pay-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label>Méthode</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pay-note">Note (optionnel)</Label>
            <Input
              id="pay-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Référence, commentaire..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
