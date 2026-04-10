/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PayLedgerSection — Section principale Phase 1 (smoke test)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Composant à brancher dans FacturesPage via import optionnel + feature flag.
 * Affiche :
 *   - Récap mensuel (total dette / payé / reste)
 *   - Liste des dettes par fournisseur (badge statut calculé)
 *   - Bouton "Ajouter paiement" par dette
 *   - Void paiement (avec raison obligatoire)
 *
 * RÈGLES :
 *   - Aucune lecture/écriture sur invoices.is_paid.
 *   - Statut = calculé, jamais stocké.
 *   - Isolation : ce composant n'importe rien de src/modules/factures/.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { Plus, ChevronDown, ChevronRight, AlertCircle, Ban, Calendar, DatabaseZap, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddPaymentDialog } from "./AddPaymentDialog";
import {
  usePayLedgerMonth,
  usePayInvoiceDetail,
  useVoidPayment,
  useAllSupplierRules,
  useBackfillPayInvoices,
} from "../hooks/usePayLedger";
import {
  computeInvoicePaid,
  computeInvoiceRemaining,
  computeInvoiceStatus,
  computeExpectedDueDate,
  formatEurPay,
  formatDateKey,
  statusLabel,
  statusColor,
} from "../engine/payEngine";
import type { PayInvoice, PayAllocationWithVoidStatus, PaySupplierRule } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface PayLedgerSectionProps {
  organizationId: string;
  establishmentId: string;
  /** Mois courant au format "YYYY-MM" */
  yearMonth: string;
  /** Nom du fournisseur par supplier_id (depuis le module parent) */
  supplierNames: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sous-composant : ligne dette avec détail paiements
// ─────────────────────────────────────────────────────────────────────────────

function PayInvoiceRow({
  invoice,
  allocations,
  organizationId,
  establishmentId,
  yearMonth,
  supplierName,
  supplierRule,
  onVoidRequest,
}: {
  invoice: PayInvoice;
  allocations: PayAllocationWithVoidStatus[];
  organizationId: string;
  establishmentId: string;
  yearMonth: string;
  supplierName: string;
  supplierRule: PaySupplierRule | null;
  onVoidRequest: (paymentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const { allocations: invoiceAllocations } = usePayInvoiceDetail(open ? invoice.id : null);
  const mergedAllocations = open ? invoiceAllocations : allocations;

  const paid      = computeInvoicePaid(invoice.id, mergedAllocations);
  const remaining = computeInvoiceRemaining(invoice, paid);
  const status    = computeInvoiceStatus(invoice, paid);

  // ── Échéance attendue (pure, Paris-safe, sans schedule items en liste) ──
  const expectedDue = computeExpectedDueDate(invoice.invoice_date, supplierRule);

  const dueDateLabel: string | null = (() => {
    if (!supplierRule || supplierRule.mode === "none" || supplierRule.mode === "manual_transfer") return null;
    if (supplierRule.mode === "installments") return null; // réservé au détail
    if (!expectedDue) return null;
    return formatDateKey(expectedDue);
  })();

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/40 transition-colors gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {invoice.label || invoice.invoice_date}
              </p>
              <p className="text-xs text-muted-foreground">{invoice.invoice_date}</p>
              {dueDateLabel && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Calendar className="h-3 w-3 shrink-0" />
                  Échéance attendue : {dueDateLabel}
                </p>
              )}
              {!dueDateLabel && supplierRule?.mode === "installments" && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Calendar className="h-3 w-3 shrink-0" />
                  Prochaine échéance : voir détail
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums">{formatEurPay(invoice.amount_eur)}</p>
              {remaining > 0 && (
                <p className="text-xs text-muted-foreground tabular-nums">Reste : {formatEurPay(remaining)}</p>
              )}
            </div>
            <Badge className={`text-xs ${statusColor(status)}`}>
              {statusLabel(status)}
            </Badge>
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-6 mt-1 mb-2 space-y-1 border-l pl-3">
          {invoiceAllocations.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Aucun paiement</p>
          ) : (
            invoiceAllocations.map((alloc) => (
              <div
                key={alloc.id}
                className={`flex items-center justify-between text-xs py-1 ${
                  alloc.payment_voided_at ? "opacity-40 line-through" : ""
                }`}
              >
                <span className="text-muted-foreground">
                  {(alloc as typeof alloc & { pay_payments?: { payment_date?: string; method?: string } }).pay_payments?.payment_date ?? "—"}
                  {" · "}
                  {(alloc as typeof alloc & { pay_payments?: { method?: string } }).pay_payments?.method ?? "—"}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium">{formatEurPay(alloc.amount_eur)}</span>
                  {!alloc.payment_voided_at && (
                    <button
                      onClick={() => onVoidRequest(alloc.payment_id)}
                      className="text-destructive hover:text-destructive/80 transition-colors"
                      title="Annuler ce paiement"
                    >
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          {remaining > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-7 text-xs"
              onClick={(e) => { e.stopPropagation(); setAddOpen(true); }}
            >
              <Plus className="h-3 w-3 mr-1" />
              Ajouter un paiement
            </Button>
          )}
        </div>
      </CollapsibleContent>

      <AddPaymentDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        organizationId={organizationId}
        establishmentId={establishmentId}
        supplierId={invoice.supplier_id}
        payInvoiceId={invoice.id}
        yearMonth={yearMonth}
        remaining={remaining}
        supplierName={supplierName}
        invoiceLabel={invoice.label}
      />
    </Collapsible>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Void Payment Dialog
// ─────────────────────────────────────────────────────────────────────────────

function VoidPaymentDialog({
  open,
  onClose,
  paymentId,
  establishmentId,
  yearMonth,
}: {
  open: boolean;
  onClose: () => void;
  paymentId: string | null;
  establishmentId: string;
  yearMonth: string;
}) {
  const [reason, setReason] = useState("");
  const voidMutation = useVoidPayment(establishmentId, yearMonth);

  const handleVoid = async () => {
    if (!paymentId) return;
    if (!reason.trim()) {
      toast.error("La raison d'annulation est obligatoire");
      return;
    }
    try {
      await voidMutation.mutateAsync({ paymentId, reason: reason.trim() });
      toast.success("Paiement annulé");
      setReason("");
      onClose();
    } catch {
      toast.error("Erreur lors de l'annulation");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Annuler ce paiement
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="void-reason">Raison (obligatoire)</Label>
          <Input
            id="void-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: doublon, erreur de montant..."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={voidMutation.isPending || !reason.trim()}
          >
            {voidMutation.isPending ? "Annulation..." : "Confirmer l'annulation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function PayLedgerSection({
  organizationId,
  establishmentId,
  yearMonth,
  supplierNames,
}: PayLedgerSectionProps) {
  const { invoices, allocations, recap, isLoading, isError } =
    usePayLedgerMonth(establishmentId, yearMonth);
  const { data: allRules = [] } = useAllSupplierRules(establishmentId);
  const backfillMutation = useBackfillPayInvoices(establishmentId, yearMonth);

  const rulesMap = new Map(allRules.map((r) => [r.supplier_id, r]));
  const [voidPaymentId, setVoidPaymentId] = useState<string | null>(null);

  const handleBackfill = async () => {
    try {
      const result = await backfillMutation.mutateAsync({ organizationId });
      if (result.created === 0) {
        toast.info(`Aucune nouvelle dette à créer (${result.skipped} factures déjà synchronisées)`);
      } else {
        toast.success(`${result.created} dette(s) créée(s) — ${result.skipped} déjà synchronisée(s)`);
      }
    } catch {
      toast.error("Erreur lors de l'initialisation des dettes");
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-pulse text-muted-foreground text-sm">Chargement paiements...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 text-center text-destructive text-sm">
        Impossible de charger les données paiements.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Récap mensuel ─── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 bg-muted rounded-lg text-center">
          <p className="text-xs text-muted-foreground mb-1">Dette suivie</p>
          <p className="text-lg font-bold tabular-nums">{formatEurPay(recap.total_dette)}</p>
        </div>
        <div className="p-4 bg-muted rounded-lg text-center border border-primary/20">
          <p className="text-xs text-muted-foreground mb-1">Payé</p>
          <p className="text-lg font-bold tabular-nums text-primary">{formatEurPay(recap.total_paye)}</p>
        </div>
        <div className="p-4 bg-muted rounded-lg text-center border border-destructive/20">
          <p className="text-xs text-muted-foreground mb-1">Reste</p>
          <p className="text-lg font-bold tabular-nums text-destructive">{formatEurPay(recap.reste_a_payer)}</p>
        </div>
      </div>

      {/* ─── Banner "Dettes non initialisées" ─── */}
      {invoices.length === 0 && (
        <div className="flex items-center justify-between gap-4 p-4 rounded-lg border border-warning/40 bg-warning/5">
          <div className="flex items-start gap-3">
            <DatabaseZap className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Dettes non initialisées</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cliquez sur "Initialiser dettes" pour créer automatiquement les dettes à partir des factures PDF existantes.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5"
            onClick={handleBackfill}
            disabled={backfillMutation.isPending}
          >
            {backfillMutation.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <DatabaseZap className="h-3.5 w-3.5" />
            )}
            {backfillMutation.isPending ? "Initialisation..." : "Initialiser dettes"}
          </Button>
        </div>
      )}

      {/* ─── Bouton backfill discret si dettes existent ─── */}
      {invoices.length > 0 && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-muted-foreground gap-1.5"
            onClick={handleBackfill}
            disabled={backfillMutation.isPending}
          >
            <RefreshCw className={`h-3 w-3 ${backfillMutation.isPending ? "animate-spin" : ""}`} />
            Synchroniser avec factures PDF
          </Button>
        </div>
      )}

      {/* ─── Liste dettes ─── */}
      {invoices.length > 0 && (
        <div className="space-y-2">
          {invoices.map((invoice) => (
            <PayInvoiceRow
              key={invoice.id}
              invoice={invoice}
              allocations={allocations}
              organizationId={organizationId}
              establishmentId={establishmentId}
              yearMonth={yearMonth}
              supplierName={supplierNames[invoice.supplier_id] ?? "Fournisseur inconnu"}
              supplierRule={rulesMap.get(invoice.supplier_id) ?? null}
              onVoidRequest={(paymentId) => setVoidPaymentId(paymentId)}
            />
          ))}
        </div>
      )}

      {/* ─── Void dialog ─── */}
      <VoidPaymentDialog
        open={!!voidPaymentId}
        onClose={() => setVoidPaymentId(null)}
        paymentId={voidPaymentId}
        establishmentId={establishmentId}
        yearMonth={yearMonth}
      />
    </div>
  );
}

