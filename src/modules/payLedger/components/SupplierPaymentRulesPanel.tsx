/**
 * SupplierPaymentRulesPanel — Configuration règles paiement fournisseur
 *
 * ⚠️ RÈGLES STRICTES :
 *   - Zéro affichage de dettes / factures / historique / wallet ici.
 *   - Mode "installments" = saisie du NOMBRE et des JOURS FIXES du mois uniquement.
 *   - Stockage dans pay_supplier_rules (installment_count + installment_days[]).
 *   - Aucun nouveau chemin de paiement.
 */

import { useState, useEffect } from "react";
import { toast } from "sonner";
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
import { CalendarDays, Pencil } from "lucide-react";
import {
  useSupplierRule,
  useCreateOrUpdateSupplierRule,
} from "../hooks/usePayLedger";
import type { SupplierRuleMode } from "../types";

interface SupplierPaymentRulesPanelProps {
  organizationId:  string;
  establishmentId: string;
  supplierId:      string;
  supplierName:    string;
}

const MODE_OPTIONS: { value: SupplierRuleMode; label: string }[] = [
  { value: "none",                   label: "Aucune règle" },
  { value: "manual_transfer",        label: "Virement manuel" },
  { value: "direct_debit_delay",     label: "Prélèvement J+N jours" },
  { value: "direct_debit_fixed_day", label: "Prélèvement jour fixe du mois" },
  { value: "installments",           label: "Paiement en plusieurs fois" },
];

const INSTALLMENT_COUNTS = [2, 3, 4, 5];

function modeLabel(mode: SupplierRuleMode): string {
  return MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode;
}

function ruleDescription(
  mode: SupplierRuleMode,
  delayDays: string,
  fixedDay: string,
  allowPartial: boolean,
  installmentCount: number,
  installmentDays: number[]
): string {
  if (mode === "none") return "Aucune règle configurée.";
  let desc = modeLabel(mode);
  if (mode === "direct_debit_delay" && delayDays) desc += ` — ${delayDays} jours`;
  if (mode === "direct_debit_fixed_day" && fixedDay) desc += ` — le ${fixedDay} du mois`;
  if (mode === "installments" && installmentCount > 0) {
    const daysStr = installmentDays.filter(Boolean).map((d) => `le ${d}`).join(", ");
    desc += ` — ${installmentCount} paiements${daysStr ? ` (${daysStr})` : ""}`;
  }
  desc += allowPartial ? " · paiements partiels autorisés" : " · paiements partiels non autorisés";
  return desc;
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function SupplierPaymentRulesPanel({
  organizationId,
  establishmentId,
  supplierId,
  supplierName,
}: SupplierPaymentRulesPanelProps) {
  const { data: rule, isLoading } = useSupplierRule(establishmentId, supplierId);
  const mutation = useCreateOrUpdateSupplierRule(establishmentId, supplierId);

  const [mode, setMode]                         = useState<SupplierRuleMode>("none");
  const [delayDays, setDelayDays]               = useState<string>("");
  const [fixedDay, setFixedDay]                 = useState<string>("");
  const [allowPartial, setAllowPartial]         = useState(true);
  const [isMonthlyAggregate, setIsMonthlyAggregate] = useState(false);
  const [editing, setEditing]                   = useState(false);

  // installments
  const [installmentCount, setInstallmentCount] = useState<number>(3);
  const [installmentDays,  setInstallmentDays]  = useState<string[]>(["", "", ""]);

  useEffect(() => {
    if (rule) {
      setMode(rule.mode);
      setDelayDays(rule.delay_days?.toString() ?? "");
      setFixedDay(rule.fixed_day_of_month?.toString() ?? "");
      setAllowPartial(rule.allow_partial);
      setIsMonthlyAggregate(rule.is_monthly_aggregate ?? false);
      if (rule.installment_count) {
        setInstallmentCount(rule.installment_count);
        const days = rule.installment_days ?? [];
        // Pad ou tronquer pour correspondre au count
        const padded = Array.from({ length: rule.installment_count }, (_, i) =>
          days[i] != null ? String(days[i]) : ""
        );
        setInstallmentDays(padded);
      }
      setEditing(false);
    } else if (!isLoading) {
      setEditing(true);
    }
  }, [rule, isLoading]);

  // Ajuste le tableau de jours quand le nombre change
  const handleCountChange = (n: number) => {
    setInstallmentCount(n);
    setInstallmentDays((prev) =>
      Array.from({ length: n }, (_, i) => prev[i] ?? "")
    );
  };

  const handleDayChange = (index: number, value: string) => {
    setInstallmentDays((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSave = async () => {
    if (mode === "direct_debit_delay" && (!delayDays || parseInt(delayDays) <= 0)) {
      toast.error("Saisissez un nombre de jours valide (> 0)"); return;
    }
    if (mode === "direct_debit_fixed_day") {
      const d = parseInt(fixedDay);
      if (!fixedDay || d < 1 || d > 28) { toast.error("Le jour fixe doit être entre 1 et 28"); return; }
    }
    if (mode === "installments") {
      const days = installmentDays.map((d) => parseInt(d));
      if (days.some((d) => isNaN(d) || d < 1 || d > 28)) {
        toast.error(`Tous les jours de prélèvement doivent être entre 1 et 28`); return;
      }
    }

    try {
      const days = mode === "installments"
        ? installmentDays.map((d) => parseInt(d))
        : null;

      await mutation.mutateAsync({
        organization_id:       organizationId,
        mode,
        delay_days:            mode === "direct_debit_delay"     ? parseInt(delayDays) : null,
        fixed_day_of_month:    mode === "direct_debit_fixed_day" ? parseInt(fixedDay)  : null,
        installment_count:     mode === "installments" ? installmentCount : null,
        installment_days:      days,
        allow_partial:         allowPartial,
        allocation_strategy:   "fifo_oldest",
        // Pour installments, toujours mensuel agrégé
        is_monthly_aggregate:  mode === "installments" ? true : isMonthlyAggregate,
      });
      toast.success("Règle enregistrée");
      setEditing(false);
    } catch {
      toast.error("Erreur lors de l'enregistrement");
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground py-2">Chargement…</p>;

  /* ── Vue résumée ── */
  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-4 p-4 border rounded-lg bg-muted/40">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
            Règle de paiement — {supplierName}
          </p>
          <p className="text-sm text-foreground/70">
            {ruleDescription(
              mode, delayDays, fixedDay, allowPartial,
              installmentCount,
              installmentDays.map((d) => parseInt(d)).filter((d) => !isNaN(d))
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="shrink-0 gap-1.5">
          <Pencil className="h-3.5 w-3.5" />Modifier
        </Button>
      </div>
    );
  }

  /* ── Formulaire d'édition ── */
  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
      <h3 className="font-semibold text-sm">
        Règle de paiement — <span className="text-muted-foreground">{supplierName}</span>
      </h3>

      {/* Mode */}
      <div className="space-y-1">
        <Label>Mode de règlement</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as SupplierRuleMode)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {MODE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Délai J+N */}
      {mode === "direct_debit_delay" && (
        <div className="space-y-1">
          <Label>Délai (jours après date facture)</Label>
          <Input
            type="number" min={1}
            value={delayDays}
            onChange={(e) => setDelayDays(e.target.value)}
            placeholder="ex: 30"
          />
        </div>
      )}

      {/* Jour fixe */}
      {mode === "direct_debit_fixed_day" && (
        <div className="space-y-1">
          <Label>Jour fixe du mois (1–28)</Label>
          <Input
            type="number" min={1} max={28}
            value={fixedDay}
            onChange={(e) => setFixedDay(e.target.value)}
            placeholder="ex: 5"
          />
        </div>
      )}

      {/* ── Multi-paiement (installments) ── */}
      {mode === "installments" && (
        <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            Paiement en plusieurs fois
          </p>

          {/* Nombre de paiements */}
          <div className="space-y-1">
            <Label className="text-xs">Nombre de paiements</Label>
            <Select
              value={String(installmentCount)}
              onValueChange={(v) => handleCountChange(parseInt(v))}
            >
              <SelectTrigger className="w-32 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INSTALLMENT_COUNTS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} paiements</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* N champs de jour du mois */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Jour du mois de chaque prélèvement (1–28)
            </Label>
            {installmentDays.map((day, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-24 shrink-0">
                  Prélèvement {i + 1}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">le</span>
                  <Input
                    type="number" min={1} max={28}
                    value={day}
                    onChange={(e) => handleDayChange(i, e.target.value)}
                    placeholder="ex: 5"
                    className="h-8 w-20 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">du mois</span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            Le montant par échéance = total dû du mois ÷ {installmentCount}.
            Le solde résiduel est absorbé par la dernière échéance.
          </p>
        </div>
      )}

      {/* Affichage mensuel agrégé — pour delay/fixed_day uniquement */}
      {(mode === "direct_debit_delay" || mode === "direct_debit_fixed_day") && (
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/20">
          <input
            type="checkbox" id="monthly-aggregate"
            checked={isMonthlyAggregate}
            onChange={(e) => setIsMonthlyAggregate(e.target.checked)}
            className="h-4 w-4"
          />
          <div>
            <Label htmlFor="monthly-aggregate" className="cursor-pointer text-sm">
              Paiement mensuel global (un seul prélèvement pour tout le mois)
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Si coché, le cockpit affiche un récap mensuel sans action par facture.
            </p>
          </div>
        </div>
      )}

      {/* Paiements partiels */}
      {mode !== "none" && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox" id="allow-partial"
            checked={allowPartial}
            onChange={(e) => setAllowPartial(e.target.checked)}
            className="h-4 w-4"
          />
          <Label htmlFor="allow-partial" className="cursor-pointer">
            Autoriser les paiements partiels
          </Label>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={mutation.isPending} size="sm">
          {mutation.isPending ? "Enregistrement…" : "Enregistrer la règle"}
        </Button>
        {rule && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={mutation.isPending}>
            Annuler
          </Button>
        )}
      </div>
    </div>
  );
}
