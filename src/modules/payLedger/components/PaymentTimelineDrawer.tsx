/**
 * PaymentTimelineDrawer — Timeline des paiements d'une facture
 * Historique uniquement. La saisie des échéances installments est dans SupplierPaymentsSection.
 */

import { useState } from "react";
import { Ban, Check, Clock, AlertCircle, X, FileText, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  usePayInvoiceDetail,
  useVoidPayment,
  usePayInvoicePdfLink,
} from "../hooks/usePayLedger";
import {
  computeInvoicePaid,
  computeInvoiceRemaining,
  computeInvoiceStatus,
  formatEurPay,
  statusLabel,
  statusColor,
} from "../engine/payEngine";
import type { PayInvoice, PayAllocationWithVoidStatus } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Inline void dialog
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
          {mutation.isPending ? "Annulation..." : "Confirmer annulation"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface PaymentTimelineDrawerProps {
  open:            boolean;
  onClose:         () => void;
  invoice:         PayInvoice;
  allocations:     PayAllocationWithVoidStatus[];
  establishmentId: string;
  yearMonth:       string;
  supplierName:    string;
  organizationId?: string;
  /** Callback déclenché par le CTA "Ajouter un paiement" — le parent ouvre AddPaymentDialog */
  onAddPayment?:   (invoice: PayInvoice) => void;
}

type EnrichedAlloc = PayAllocationWithVoidStatus & {
  pay_payments?: {
    payment_date?:   string;
    method?:         string;
    note?:           string;
    payment_source?: string;
    voided_at?:      string | null;
    void_reason?:    string | null;
  } | null;
};

export function PaymentTimelineDrawer({
  open,
  onClose,
  invoice,
  allocations: outerAllocations,
  establishmentId,
  yearMonth,
  supplierName,
  onAddPayment,
}: PaymentTimelineDrawerProps) {
  const [voidingPaymentId, setVoidingPaymentId] = useState<string | null>(null);

  // Chargement détaillé à l'ouverture
  const { allocations: detailAllocs, isLoading } = usePayInvoiceDetail(open ? invoice.id : null);

  // Lien PDF depuis source_invoice_id
  const { data: pdfMeta } = usePayInvoicePdfLink(
    open && invoice.source_invoice_id ? invoice.source_invoice_id : null
  );

  const allocs = (detailAllocs.length > 0 ? detailAllocs : outerAllocations.filter(
    (a) => a.pay_invoice_id === invoice.id
  )) as EnrichedAlloc[];

  const paid      = computeInvoicePaid(invoice.id, outerAllocations);
  const remaining = computeInvoiceRemaining(invoice, paid);
  const status    = computeInvoiceStatus(invoice, paid);

  const sorted = [...allocs].sort((a, b) => {
    const da = a.pay_payments?.payment_date ?? a.created_at;
    const db = b.pay_payments?.payment_date ?? b.created_at;
    return da.localeCompare(db);
  });

  const handleOpenPdf = async () => {
    if (!pdfMeta?.file_path) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).storage
        .from("invoices")
        .createSignedUrl(pdfMeta.file_path, 3600);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Impossible d'ouvrir le PDF");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Détail paiements</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {supplierName} — {invoice.label || invoice.invoice_date}
          </p>
        </DialogHeader>

        {/* ─── KPIs ─── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-muted text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">Total</p>
            <p className="text-sm font-bold tabular-nums">{formatEurPay(invoice.amount_eur)}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">Payé</p>
            <p className="text-sm font-bold tabular-nums text-primary">{formatEurPay(paid)}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted text-center border border-primary/10">
            <p className="text-[10px] text-muted-foreground mb-0.5">Reste</p>
            <p className="text-sm font-bold tabular-nums">{formatEurPay(remaining)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge className={`text-xs ${statusColor(status)}`}>{statusLabel(status)}</Badge>
        </div>

        {/* ─── Lien PDF ─── */}
        {invoice.source_invoice_id && (
          <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            {pdfMeta ? (
              <div className="flex items-center justify-between flex-1 min-w-0 gap-2">
                <span className="text-xs text-muted-foreground truncate">
                  Facture PDF : <span className="font-medium text-foreground">{pdfMeta.invoice_number ?? "Sans numéro"}</span>
                </span>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" onClick={handleOpenPdf}>
                  <ExternalLink className="h-3 w-3" />
                  Ouvrir le PDF
                </Button>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Aucun PDF lié</span>
            )}
          </div>
        )}

        {/* ─── Timeline ─── */}
        <div className="space-y-1 mt-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Historique
          </p>

          {isLoading && (
            <div className="py-4 text-center text-sm text-muted-foreground animate-pulse">
              Chargement...
            </div>
          )}

          {!isLoading && sorted.length === 0 && (
            <div className="py-6 text-center space-y-3">
              <Clock className="h-8 w-8 mx-auto text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">Aucun paiement enregistré.</p>
              <div className="flex justify-center gap-2">
                {onAddPayment && (
                   <Button size="sm" variant="default" onClick={() => { onClose(); onAddPayment(invoice); }}>
                     Ajouter un paiement
                   </Button>
                 )}
                {pdfMeta && (
                  <Button size="sm" variant="outline" className="gap-1" onClick={handleOpenPdf}>
                    <ExternalLink className="h-3 w-3" />
                    Ouvrir le PDF
                  </Button>
                )}
              </div>
            </div>
          )}

          {sorted.map((alloc) => {
            const isVoided      = !!alloc.payment_voided_at;
            const isVoiding     = voidingPaymentId === alloc.payment_id;
            const paymentDate   = alloc.pay_payments?.payment_date ?? "—";
            const method        = alloc.pay_payments?.method ?? "—";
            const note          = alloc.pay_payments?.note;
            const source        = alloc.pay_payments?.payment_source;
            const isAutoPayment = source === "auto";

            return (
              <div
                key={alloc.id}
                className={`rounded-lg border p-3 space-y-1.5 transition-opacity ${
                  isVoided ? "opacity-50 bg-muted/50" : "bg-card"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isVoided ? (
                      <X className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <Check className="h-4 w-4 text-green-600 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium tabular-nums">
                        {formatEurPay(alloc.amount_eur)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {paymentDate} · {method}
                        {isAutoPayment && (
                          <Badge className="ml-1 text-[10px] px-1 py-0 bg-blue-100 text-blue-700">auto</Badge>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isVoided ? (
                      <Badge className="text-[10px] bg-muted text-muted-foreground">Annulé</Badge>
                    ) : isAutoPayment ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 text-xs gap-1"
                        onClick={() => setVoidingPaymentId(isVoiding ? null : alloc.payment_id)}
                        title="Prélèvement refusé"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Refusé</span>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                        onClick={() => setVoidingPaymentId(isVoiding ? null : alloc.payment_id)}
                        title="Annuler ce paiement"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {note && (
                  <p className="text-xs text-muted-foreground pl-6">{note}</p>
                )}

                {isVoided && alloc.pay_payments?.void_reason && (
                  <p className="text-xs text-muted-foreground pl-6 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    Motif : {alloc.pay_payments.void_reason}
                  </p>
                )}

                {isVoiding && (
                  <VoidConfirmInline
                    paymentId={alloc.payment_id}
                    establishmentId={establishmentId}
                    yearMonth={yearMonth}
                    onDone={() => setVoidingPaymentId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>Fermer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
