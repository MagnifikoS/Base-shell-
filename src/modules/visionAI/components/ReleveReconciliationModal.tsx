/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — ReleveReconciliationModal
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Full-screen Sheet modal for reviewing Releve (statement of account)
 * reconciliation results. Displays 3 sections:
 *
 * 1. Releve Header Summary (supplier, period, balances)
 * 2. Reconciliation Table (matched/missing lines with status color coding)
 * 3. Summary & Alerts (totals, balance diff, guardrail flags)
 *
 * READ-ONLY: This modal NEVER writes to the invoices table.
 * All data is session-only and discarded on close.
 */

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Scale,
} from "lucide-react";

import type {
  ReleveExtractionResponse,
  ReconciliationResult,
  MatchedLine,
  ReleveLine,
  ReconciliationLineStatus,
  ReconciliationAlertSeverity,
} from "../types/releveTypes";
import type {
  ReleveGuardrailResult,
  ReleveFlag,
  ReleveFlagSeverity,
} from "../plugins/visionReleveGuardrails";

// ═══════════════════════════════════════════════════════════════════════════
// PROPS
// ═══════════════════════════════════════════════════════════════════════════

interface ReleveReconciliationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  releveResponse: ReleveExtractionResponse | null;
  reconciliation: ReconciliationResult | null;
  guardrails: ReleveGuardrailResult | null;
  isReconciling: boolean;
  /** Called when user validates reconciliation */
  onValidated: () => void;
  /** Called on cancel (SAS cleanup) */
  onCancel: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatAmount(amount: number | null): string {
  if (amount === null) return "—";
  return (
    amount.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " \u20AC"
  );
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  // Dates are YYYY-MM-DD, display as DD/MM/YYYY
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function getStatusLabel(status: ReconciliationLineStatus): string {
  switch (status) {
    case "exact_match":
      return "Exact";
    case "amount_mismatch":
      return "Ecart montant";
    case "date_mismatch":
      return "Ecart date";
    case "partial_match":
      return "Partiel";
    default:
      return status;
  }
}

function getStatusBadgeVariant(
  status: ReconciliationLineStatus
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "exact_match":
      return "default";
    case "amount_mismatch":
    case "date_mismatch":
      return "secondary";
    case "partial_match":
      return "outline";
    default:
      return "secondary";
  }
}

function getRowClassName(status: ReconciliationLineStatus): string {
  switch (status) {
    case "exact_match":
      return "bg-green-50 dark:bg-green-950/30 border-l-4 border-green-500";
    case "amount_mismatch":
    case "date_mismatch":
      return "bg-yellow-50 dark:bg-yellow-950/30 border-l-4 border-yellow-500 dark:border-yellow-600";
    case "partial_match":
      return "bg-blue-50 dark:bg-blue-950/30 border-l-4 border-blue-500 dark:border-blue-600";
    default:
      return "";
  }
}

/** Sort guardrail flags by severity: alert first, then warning, then info */
function sortFlagsBySeverity(flags: ReleveFlag[]): ReleveFlag[] {
  const severityOrder: Record<ReleveFlagSeverity, number> = {
    alert: 0,
    warning: 1,
    info: 2,
  };
  return [...flags].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

/** Sort reconciliation alerts by severity: critical first */
function sortAlertsBySeverity(
  alerts: ReconciliationResult["alerts"]
): ReconciliationResult["alerts"] {
  const severityOrder: Record<ReconciliationAlertSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return [...alerts].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
      </div>
      <p className="text-lg font-medium text-foreground">Rapprochement en cours...</p>
      <p className="text-sm text-muted-foreground">
        Comparaison des lignes du releve avec les factures en base
      </p>
    </div>
  );
}

function HeaderSection({
  releveResponse,
  reconciliation,
}: {
  releveResponse: ReleveExtractionResponse;
  reconciliation: ReconciliationResult;
}) {
  const header = releveResponse.releve;
  const supplierFound = reconciliation.supplier_id !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">
                {header.supplier_name ?? "Fournisseur inconnu"}
              </h3>
              {supplierFound ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500 dark:text-red-400" />
              )}
            </div>
            {header.supplier_account_ref && (
              <p className="text-sm text-muted-foreground">
                Ref. compte : {header.supplier_account_ref}
              </p>
            )}
          </div>
        </div>

        {releveResponse.document_quality && (
          <Badge
            variant={releveResponse.document_quality.score >= 0.7 ? "default" : "destructive"}
            className="text-xs"
          >
            Qualite : {Math.round(releveResponse.document_quality.score * 100)}%
          </Badge>
        )}
      </div>

      {/* Period */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Periode :</span>
        <span className="font-medium text-foreground">{formatDate(header.period_start)}</span>
        <ArrowRight className="h-3 w-3" />
        <span className="font-medium text-foreground">{formatDate(header.period_end)}</span>
      </div>

      {/* Balance Fields */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BalanceCard label="Solde precedent" amount={header.previous_balance} />
        <BalanceCard label="Total facture" amount={header.total_invoiced} />
        <BalanceCard label="Total avoirs" amount={header.total_credits} />
        <BalanceCard label="Solde du" amount={header.balance_due} highlight />
      </div>
    </div>
  );
}

function BalanceCard({
  label,
  amount,
  highlight = false,
}: {
  label: string;
  amount: number | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight ? "border-primary bg-primary/5" : "bg-muted/30"
      }`}
    >
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-sm font-semibold ${highlight ? "text-primary" : "text-foreground"}`}>
        {formatAmount(amount)}
      </p>
    </div>
  );
}

function ReconciliationTable({ reconciliation }: { reconciliation: ReconciliationResult }) {
  const { matched_lines, missing_from_db, missing_from_releve } = reconciliation;

  const hasAnyRows =
    matched_lines.length > 0 || missing_from_db.length > 0 || missing_from_releve.length > 0;

  if (!hasAnyRows) {
    return <div className="text-center py-8 text-muted-foreground">Aucune ligne a rapprocher</div>;
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-left px-3 py-2 font-medium">Reference releve</th>
            <th className="text-left px-3 py-2 font-medium">Notre facture</th>
            <th className="text-right px-3 py-2 font-medium">Montant releve</th>
            <th className="text-right px-3 py-2 font-medium">Montant base</th>
            <th className="text-center px-3 py-2 font-medium">Statut</th>
            <th className="text-right px-3 py-2 font-medium">Ecart</th>
          </tr>
        </thead>
        <tbody>
          {/* Matched lines first */}
          {matched_lines.map((match, idx) => (
            <MatchedRow key={`matched-${idx}`} match={match} />
          ))}

          {/* Missing from DB (in releve but not in our invoices) */}
          {missing_from_db.map((line, idx) => (
            <MissingFromDbRow key={`missing-db-${idx}`} line={line} />
          ))}

          {/* Missing from releve (in our DB but not in the releve) */}
          {missing_from_releve.map((invoice, idx) => (
            <MissingFromReleveRow key={`missing-releve-${idx}`} invoice={invoice} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchedRow({ match }: { match: MatchedLine }) {
  return (
    <tr className={getRowClassName(match.status)}>
      <td className="px-3 py-2">{match.releve_line.reference ?? "—"}</td>
      <td className="px-3 py-2">
        {match.db_invoice.invoice_number ?? match.db_invoice.id.slice(0, 8)}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatAmount(match.releve_line.amount_ttc)}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatAmount(match.db_invoice.amount_eur)}
      </td>
      <td className="px-3 py-2 text-center">
        <Badge variant={getStatusBadgeVariant(match.status)} className="text-xs">
          {getStatusLabel(match.status)}
        </Badge>
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {match.amount_difference !== null ? formatAmount(match.amount_difference) : "—"}
      </td>
    </tr>
  );
}

function MissingFromDbRow({ line }: { line: ReleveLine }) {
  return (
    <tr className="bg-red-50 dark:bg-red-950/30 border-l-4 border-red-500">
      <td className="px-3 py-2">{line.reference ?? "—"}</td>
      <td className="px-3 py-2 text-muted-foreground italic">Non trouvee en base</td>
      <td className="px-3 py-2 text-right font-mono">{formatAmount(line.amount_ttc)}</td>
      <td className="px-3 py-2 text-right text-muted-foreground">—</td>
      <td className="px-3 py-2 text-center">
        <Badge variant="destructive" className="text-xs">
          Absente
        </Badge>
      </td>
      <td className="px-3 py-2 text-right text-muted-foreground">—</td>
    </tr>
  );
}

function MissingFromReleveRow({
  invoice,
}: {
  invoice: ReconciliationResult["missing_from_releve"][number];
}) {
  return (
    <tr className="bg-muted/50 border-l-4 border-border">
      <td className="px-3 py-2 text-muted-foreground italic">Absente du releve</td>
      <td className="px-3 py-2">{invoice.invoice_number ?? invoice.id.slice(0, 8)}</td>
      <td className="px-3 py-2 text-right text-muted-foreground">—</td>
      <td className="px-3 py-2 text-right font-mono">{formatAmount(invoice.amount_eur)}</td>
      <td className="px-3 py-2 text-center">
        <Badge variant="outline" className="text-xs">
          Hors releve
        </Badge>
      </td>
      <td className="px-3 py-2 text-right text-muted-foreground">—</td>
    </tr>
  );
}

function SummarySection({
  reconciliation,
  guardrails,
}: {
  reconciliation: ReconciliationResult;
  guardrails: ReleveGuardrailResult | null;
}) {
  const balanceDiffNonZero = Math.abs(reconciliation.balance_difference) > 0.01;

  // Merge alerts from reconciliation + flags from guardrails
  const sortedAlerts = sortAlertsBySeverity(reconciliation.alerts);
  const sortedFlags = guardrails ? sortFlagsBySeverity(guardrails.flags) : [];

  return (
    <div className="space-y-4">
      {/* Totals comparison */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Total releve</p>
          <p className="text-xl font-bold text-foreground">
            {formatAmount(reconciliation.total_releve)}
          </p>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Total base</p>
          <p className="text-xl font-bold text-foreground">
            {formatAmount(reconciliation.total_db)}
          </p>
        </div>
      </div>

      {/* Balance difference */}
      <div
        className={`rounded-lg border p-4 flex items-center justify-between ${
          balanceDiffNonZero
            ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30"
            : "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30"
        }`}
      >
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          <span className="font-medium">Ecart de solde</span>
        </div>
        <span
          className={`text-lg font-bold ${balanceDiffNonZero ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}
        >
          {formatAmount(reconciliation.balance_difference)}
        </span>
      </div>

      {/* Reconciliation Alerts */}
      {sortedAlerts.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">Alertes de rapprochement</h4>
          <div className="space-y-1.5">
            {sortedAlerts.map((alert, idx) => (
              <AlertRow key={`alert-${idx}`} severity={alert.severity} message={alert.message} />
            ))}
          </div>
        </div>
      )}

      {/* Guardrail Flags */}
      {sortedFlags.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">Controles automatiques</h4>
          <div className="space-y-1.5">
            {sortedFlags.map((flag, idx) => (
              <GuardrailFlagRow key={`flag-${idx}`} flag={flag} />
            ))}
          </div>
        </div>
      )}

      {/* No issues at all */}
      {sortedAlerts.length === 0 && sortedFlags.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 p-4">
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          <span className="text-sm font-medium text-green-700 dark:text-green-400">
            Aucune anomalie detectee
          </span>
        </div>
      )}
    </div>
  );
}

function AlertRow({
  severity,
  message,
}: {
  severity: ReconciliationAlertSeverity;
  message: string;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <SeverityBadge severity={severity} />
      <span className="text-foreground leading-5">{message}</span>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: ReconciliationAlertSeverity }) {
  switch (severity) {
    case "critical":
      return (
        <Badge variant="destructive" className="text-xs shrink-0">
          Critique
        </Badge>
      );
    case "warning":
      return (
        <Badge className="text-xs shrink-0 bg-yellow-500 dark:bg-yellow-600 hover:bg-yellow-600 dark:hover:bg-yellow-500 text-white border-yellow-500 dark:border-yellow-600">
          Attention
        </Badge>
      );
    case "info":
      return (
        <Badge
          variant="secondary"
          className="text-xs shrink-0 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800"
        >
          Info
        </Badge>
      );
    default:
      return null;
  }
}

function GuardrailFlagRow({ flag }: { flag: ReleveFlag }) {
  const severityMap: Record<ReleveFlagSeverity, ReconciliationAlertSeverity> = {
    alert: "critical",
    warning: "warning",
    info: "info",
  };

  return (
    <div className="flex items-start gap-2 text-sm">
      <SeverityBadge severity={severityMap[flag.severity]} />
      <span className="text-foreground leading-5">{flag.message}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function ReleveReconciliationModal({
  open,
  onOpenChange,
  releveResponse,
  reconciliation,
  guardrails,
  isReconciling,
  onValidated,
  onCancel,
}: ReleveReconciliationModalProps) {
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onCancel();
      return;
    }
    onOpenChange(isOpen);
  };

  const hasContent = releveResponse !== null && reconciliation !== null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl lg:max-w-4xl p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Rapprochement du releve
          </SheetTitle>
          <SheetDescription>
            Comparaison entre le releve fournisseur et les factures enregistrees
          </SheetDescription>
        </SheetHeader>

        <Separator />

        {/* Content area */}
        {isReconciling ? (
          <LoadingState />
        ) : !hasContent ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <AlertTriangle className="h-10 w-10 mb-4 text-muted-foreground/50" />
            <p>Aucune donnee de rapprochement disponible</p>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-6 py-4 space-y-6">
              {/* Section 1: Header Summary */}
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Informations du releve
                </h3>
                <HeaderSection releveResponse={releveResponse} reconciliation={reconciliation} />
              </section>

              <Separator />

              {/* Section 2: Reconciliation Table */}
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Detail du rapprochement
                  <span className="ml-2 text-xs font-normal">
                    ({reconciliation.matched_lines.length} rapprochee(s),{" "}
                    {reconciliation.missing_from_db.length} absente(s) en base,{" "}
                    {reconciliation.missing_from_releve.length} hors releve)
                  </span>
                </h3>
                <ReconciliationTable reconciliation={reconciliation} />
              </section>

              <Separator />

              {/* Section 3: Summary & Alerts */}
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Synthese et alertes
                </h3>
                <SummarySection reconciliation={reconciliation} guardrails={guardrails} />
              </section>
            </div>
          </ScrollArea>
        )}

        {/* Bottom Actions */}
        <Separator />
        <div className="px-6 py-4 flex items-center justify-end gap-3 shrink-0">
          <Button variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
          <Button onClick={onValidated} disabled={isReconciling || !hasContent}>
            Valider le rapprochement
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
