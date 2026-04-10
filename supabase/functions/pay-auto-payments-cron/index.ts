/**
 * ═══════════════════════════════════════════════════════════════════════════
 * pay-auto-payments-cron — Edge Function planifiée toutes les heures
 * ═══════════════════════════════════════════════════════════════════════════
 * Déclenché par pg_cron (0 * * * *).
 * Parcourt tous les établissements avec auto_record_direct_debit = true.
 *
 * Modes traités :
 *   - direct_debit_delay     → échéance = invoice_date + delay_days
 *   - direct_debit_fixed_day → échéance = prochain jour fixe du mois
 *   - installments           → échéances = pay_schedule_items.due_date <= today
 *
 * Idempotence :
 *   - Clé de base : auto-{invoice_id}-{due_date_str}  (modes delay/fixed)
 *                   auto-sched-{schedule_item_id}       (mode installments)
 *   - Si paiement voidé → compte les voids existants et crée -v{N+1}
 *   - Vérifie l'allocation avant insert (pas de doublon)
 *
 * ❌ Aucun bouton utilisateur — entièrement automatique côté serveur.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Date locale Paris (Europe/Paris) au format YYYY-MM-DD — évite le décalage UTC */
function toDateStr(d: Date): string {
  const paris = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const y   = paris.getFullYear();
  const m   = String(paris.getMonth() + 1).padStart(2, "0");
  const day = String(paris.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** yearMonth au format "YYYY-MM" depuis une date "YYYY-MM-DD" */
function yearMonthOf(dateStr: string): string {
  return dateStr.substring(0, 7);
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert payment + allocation idempotent — SSOT interne du CRON
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ DUPLICATION INTENTIONNELLE vs createPaymentWithAllocation (service client)
// ─────────────────────────────────────────────────────────────────────────────
// Cette fonction est distincte de createPaymentWithAllocation pour trois raisons :
//
//   1. CONTEXTE DENO : les Edge Functions n'ont pas accès au client browser
//      Supabase (src/integrations/supabase/client). Elles utilisent le service
//      role key via createClient(URL, SERVICE_ROLE_KEY). Un import partagé est
//      impossible sans refactoring structurel contraire à la politique Minimal
//      Intervention.
//
//   2. SÉMANTIQUE DIFFÉRENTE : createPaymentWithAllocation est manuel (source=
//      "manuel", idempotency_key=UUID aléatoire). Ici la source est "auto" et
//      la clé est déterministe (auto-{id}-{date} ou auto-sched-{item_id}).
//
//   3. RETRY VOID SPÉCIFIQUE : le chemin manuel ne nécessite pas de retry
//      versionné (l'utilisateur voit l'erreur). Le CRON doit gérer silencieusement
//      les paiements voidés entre deux runs.
//
// ─────────────────────────────────────────────────────────────────────────────
// LOGIQUE DU COMPTEUR VERSIONNEMENT :
// ─────────────────────────────────────────────────────────────────────────────
//   nextN = (nombre TOTAL de paiements dont idempotency_key LIKE base_key%) + 1
//
//   ⚠️ Ce n'est PAS le "nombre de voids". C'est le nombre total de paiements
//   (voidés ou non) partageant la même racine de clé.
//
//   Exemple :
//     - Run 1 : base_key créé         → nextN = 1, clé = base_key     (voidé après)
//     - Run 2 : base_key-v2 créé      → nextN = 2  (1 total + 1)      (voidé après)
//     - Run 3 : base_key-v3 créé      → nextN = 3  (2 total + 1)
//
//   Cela garantit que la clé est toujours unique même si un paiement non-voidé
//   existe déjà dans la série (cas anormal mais protégé).
// ─────────────────────────────────────────────────────────────────────────────

async function createAutoPaymentIdempotent(
  supabase: ReturnType<typeof createClient>,
  params: {
    organization_id:  string;
    establishment_id: string;
    supplier_id:      string;
    pay_invoice_id:   string;
    payment_date:     string;
    amount_eur:       number;
    method:           string;
    base_key:         string;
  }
): Promise<{ ok: boolean; action: "created" | "skipped" | "retry"; error?: string }> {
  const {
    organization_id, establishment_id, supplier_id,
    pay_invoice_id, payment_date, amount_eur, method, base_key,
  } = params;

  const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

  try {
    // 1. Upsert paiement (ignoreDuplicates sur clé unique)
    const { data: upsertData, error: upsertErr } = await supabase
      .from("pay_payments")
      .upsert(
        {
          organization_id,
          establishment_id,
          supplier_id,
          payment_date,
          amount_eur,
          method,
          payment_source:  "auto",
          idempotency_key: base_key,
          created_by:      SYSTEM_USER,
        },
        { onConflict: "establishment_id,idempotency_key", ignoreDuplicates: true }
      )
      .select()
      .maybeSingle();

    if (upsertErr) return { ok: false, action: "skipped", error: upsertErr.message };

    // 2. Si ignoré → SELECT existing
    let payment = upsertData as Record<string, unknown> | null;
    if (!payment) {
      const { data: existing, error: selErr } = await supabase
        .from("pay_payments")
        .select("*")
        .eq("establishment_id", establishment_id)
        .eq("idempotency_key", base_key)
        .maybeSingle();
      if (selErr) return { ok: false, action: "skipped", error: selErr.message };
      payment = existing as Record<string, unknown> | null;
    }

    // 3. Si voidé → retry versionnée robuste
    if (payment && payment.voided_at !== null) {
      const { data: allWithBase, error: cntErr } = await supabase
        .from("pay_payments")
        .select("id, voided_at")
        .eq("establishment_id", establishment_id)
        .like("idempotency_key", `${base_key}%`);
      if (cntErr) return { ok: false, action: "skipped", error: cntErr.message };

      const nextN = (allWithBase ?? []).length + 1;
      const retryKey = `${base_key}-v${nextN}`;

      const { data: retryData, error: retryErr } = await supabase
        .from("pay_payments")
        .insert({
          organization_id,
          establishment_id,
          supplier_id,
          payment_date,
          amount_eur,
          method,
          payment_source:  "auto",
          idempotency_key: retryKey,
          created_by:      SYSTEM_USER,
        })
        .select()
        .single();
      if (retryErr) return { ok: false, action: "skipped", error: retryErr.message };
      payment = retryData as Record<string, unknown>;
    }

    if (!payment) return { ok: false, action: "skipped", error: "payment_null" };

    // 4. Vérifier doublon allocation
    const { data: existingAlloc, error: checkErr } = await supabase
      .from("pay_allocations")
      .select("id")
      .eq("payment_id", payment.id as string)
      .eq("pay_invoice_id", pay_invoice_id)
      .maybeSingle();
    if (checkErr) return { ok: false, action: "skipped", error: checkErr.message };
    if (existingAlloc) return { ok: true, action: "skipped" };

    // 5. Créer l'allocation
    const { error: allErr } = await supabase
      .from("pay_allocations")
      .insert({
        organization_id,
        establishment_id,
        payment_id:    payment.id,
        pay_invoice_id,
        amount_eur,
        created_by:    SYSTEM_USER,
      });
    if (allErr) return { ok: false, action: "skipped", error: allErr.message };

    return { ok: true, action: "created" };
  } catch (e) {
    return { ok: false, action: "skipped", error: String(e) };
  }
}

/**
 * Crée un paiement auto et distribue le montant en FIFO sur plusieurs factures.
 * Chaque facture reçoit au maximum son "remaining" avant de passer à la suivante.
 */
async function createAutoPaymentFIFO(
  supabase: ReturnType<typeof createClient>,
  params: {
    organization_id:  string;
    establishment_id: string;
    supplier_id:      string;
    sortedInvoices:   Array<{ id: string; amount_eur: number }>;
    paidByInvoice:    Map<string, number>;
    payment_date:     string;
    amount_eur:       number;
    method:           string;
    base_key:         string;
  }
): Promise<{ ok: boolean; action: "created" | "skipped"; error?: string }> {
  const {
    organization_id, establishment_id, supplier_id,
    sortedInvoices, paidByInvoice, payment_date, amount_eur, method, base_key,
  } = params;

  const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

  try {
    // 1. Upsert paiement
    const { data: upsertData, error: upsertErr } = await supabase
      .from("pay_payments")
      .upsert(
        {
          organization_id,
          establishment_id,
          supplier_id,
          payment_date,
          amount_eur,
          method,
          payment_source:  "auto",
          idempotency_key: base_key,
          created_by:      SYSTEM_USER,
        },
        { onConflict: "establishment_id,idempotency_key", ignoreDuplicates: true }
      )
      .select()
      .maybeSingle();

    if (upsertErr) return { ok: false, action: "skipped", error: upsertErr.message };

    let payment = upsertData as Record<string, unknown> | null;
    if (!payment) {
      const { data: existing, error: selErr } = await supabase
        .from("pay_payments")
        .select("*")
        .eq("establishment_id", establishment_id)
        .eq("idempotency_key", base_key)
        .maybeSingle();
      if (selErr) return { ok: false, action: "skipped", error: selErr.message };
      payment = existing as Record<string, unknown> | null;
    }

    // Si voidé → retry versionnée
    if (payment && payment.voided_at !== null) {
      const { data: allWithBase, error: cntErr } = await supabase
        .from("pay_payments")
        .select("id, voided_at")
        .eq("establishment_id", establishment_id)
        .like("idempotency_key", `${base_key}%`);
      if (cntErr) return { ok: false, action: "skipped", error: cntErr.message };

      const nextN = (allWithBase ?? []).length + 1;
      const retryKey = `${base_key}-v${nextN}`;

      const { data: retryData, error: retryErr } = await supabase
        .from("pay_payments")
        .insert({
          organization_id, establishment_id, supplier_id,
          payment_date, amount_eur, method,
          payment_source: "auto", idempotency_key: retryKey, created_by: SYSTEM_USER,
        })
        .select()
        .single();
      if (retryErr) return { ok: false, action: "skipped", error: retryErr.message };
      payment = retryData as Record<string, unknown>;
    }

    if (!payment) return { ok: false, action: "skipped", error: "payment_null" };

    // 2. Vérifier si des allocations existent déjà pour ce paiement
    const { data: existingAllocs, error: checkErr } = await supabase
      .from("pay_allocations")
      .select("id")
      .eq("payment_id", payment.id as string);
    if (checkErr) return { ok: false, action: "skipped", error: checkErr.message };
    if (existingAllocs && existingAllocs.length > 0) return { ok: true, action: "skipped" };

    // 3. Distribuer en FIFO : remplir chaque facture jusqu'à son remaining
    let budgetLeft = amount_eur;
    const allocRows: Array<{
      organization_id: string; establishment_id: string;
      payment_id: string; pay_invoice_id: string; amount_eur: number; created_by: string;
    }> = [];

    for (const inv of sortedInvoices) {
      if (budgetLeft <= 0.005) break;
      const paid = paidByInvoice.get(inv.id) ?? 0;
      const invRemaining = round2(Math.max(0, inv.amount_eur - paid));
      if (invRemaining <= 0.005) continue;

      const allocAmount = round2(Math.min(budgetLeft, invRemaining));
      allocRows.push({
        organization_id,
        establishment_id,
        payment_id:    payment.id as string,
        pay_invoice_id: inv.id,
        amount_eur:    allocAmount,
        created_by:    SYSTEM_USER,
      });
      budgetLeft = round2(budgetLeft - allocAmount);
    }

    if (allocRows.length === 0) return { ok: true, action: "skipped" };

    const { error: allErr } = await supabase
      .from("pay_allocations")
      .insert(allocRows);
    if (allErr) return { ok: false, action: "skipped", error: allErr.message };

    return { ok: true, action: "created" };
  } catch (e) {
    return { ok: false, action: "skipped", error: String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler principal
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  const todayStr = toDateStr(new Date());

  // ── 1. Établissements avec auto_record = true ──────────────────────────────
  const { data: settings, error: settingsErr } = await supabase
    .from("pay_establishment_settings")
    .select("establishment_id, organization_id")
    .eq("auto_record_direct_debit", true);

  if (settingsErr) {
    console.error("pay-auto-payments-cron: error fetching settings", settingsErr);
    return new Response(JSON.stringify({ error: settingsErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const activeEstablishments = (settings ?? []) as Array<{
    establishment_id: string;
    organization_id:  string;
  }>;

  console.log(`pay-auto-payments-cron: ${activeEstablishments.length} établissement(s) avec auto=true — date=${todayStr}`);

  let totalCreated = 0;
  const estabResults: Array<{ establishment_id: string; created: number; errors: string[] }> = [];

  // ── 2. Boucle établissements ──────────────────────────────────────────────
  for (const { establishment_id, organization_id } of activeEstablishments) {
    let created = 0;
    const errors: string[] = [];

    try {
      // ── 2a. Charger dettes, allocations, règles ──────────────────────────
      const [invoicesRes, allocationsRes, rulesRes] = await Promise.all([
        supabase.from("pay_invoices").select("*").eq("establishment_id", establishment_id),
        supabase.from("pay_allocations")
          .select("id, pay_invoice_id, payment_id, amount_eur, pay_payments(voided_at)")
          .eq("establishment_id", establishment_id),
        supabase.from("pay_supplier_rules").select("*").eq("establishment_id", establishment_id),
      ]);

      if (invoicesRes.error)    throw invoicesRes.error;
      if (allocationsRes.error) throw allocationsRes.error;
      if (rulesRes.error)       throw rulesRes.error;

      const invoices  = (invoicesRes.data ?? [])  as Array<Record<string, unknown>>;
      const rulesMap  = new Map(
        ((rulesRes.data ?? []) as Array<Record<string, unknown>>).map((r) => [r.supplier_id as string, r])
      );

      // Calcul du paid courant par facture
      type AllocRow = { pay_invoice_id: string; payment_id: string; amount_eur: number; pay_payments: { voided_at: string | null } | null };
      const rawAllocs = (allocationsRes.data ?? []) as AllocRow[];
      const paidByInvoice = new Map<string, number>();
      for (const a of rawAllocs) {
        if (a.pay_payments?.voided_at !== null && a.pay_payments?.voided_at !== undefined) continue;
        const prev = paidByInvoice.get(a.pay_invoice_id) ?? 0;
        paidByInvoice.set(a.pay_invoice_id, round2(prev + a.amount_eur));
      }

      // ── 2b. Modes delay / fixed_day ─────────────────────────────────────
      for (const invoice of invoices) {
        const rule = rulesMap.get(invoice.supplier_id as string);
        const mode = rule?.mode as string | undefined;

        if (!rule || !mode || mode === "none" || mode === "manual_transfer" || mode === "installments") continue;

        const paid      = paidByInvoice.get(invoice.id as string) ?? 0;
        const remaining = round2(Math.max(0, (invoice.amount_eur as number) - paid));
        if (remaining <= 0) continue;

        const [yr, mo, dy] = (invoice.invoice_date as string).split("-").map(Number);
        let dueDate: Date | null = null;

        if (mode === "direct_debit_delay" && rule.delay_days != null) {
          dueDate = new Date(yr, mo - 1, dy);
          dueDate.setDate(dueDate.getDate() + (rule.delay_days as number));
        } else if (mode === "direct_debit_fixed_day" && rule.fixed_day_of_month != null) {
          // TOUJOURS M+1 : le prélèvement est le mois suivant celui de la facture.
          // mo est 1-indexed → new Date(yr, mo, fixed) = mois suivant (0-indexed).
          dueDate = new Date(yr, mo, rule.fixed_day_of_month as number);
        }

        if (!dueDate) continue;
        const dueDateStr = toDateStr(dueDate);
        if (dueDateStr > todayStr) continue;

        const res = await createAutoPaymentIdempotent(supabase, {
          organization_id,
          establishment_id,
          supplier_id:    invoice.supplier_id as string,
          pay_invoice_id: invoice.id          as string,
          payment_date:   dueDateStr,
          amount_eur:     remaining,
          method:         "prelevement",
          base_key:       `auto-${invoice.id as string}-${dueDateStr}`,
        });

        if (res.ok && res.action === "created") created++;
        else if (!res.ok) errors.push(`delay/fixed Invoice ${invoice.id as string}: ${res.error}`);
      }

      // ── 2c. Mode installments (logique M+1 — total fournisseur mensuel) ───
      //
      // PRINCIPE :
      //   - Pour chaque fournisseur en mode "installments"
      //   - On groupe ses factures par mois (invoiceYearMonth = YYYY-MM de invoice_date)
      //   - Pour chaque mois N, on calcule les N échéances sur M+1 depuis la règle
      //   - Si today >= dueDate d'une échéance → créer le paiement via le chemin unique
      //   - Allocation : FIFO strictement mensuel (toutes factures du mois N)
      //   - Idempotence : clé = "auto-inst-{supplierId}-{yearMonthN}-{dayIndex}"
      //   - Non-rétroactivité : si paiement déjà créé (alloc existante >= montant) → skip
      //
      // ⚠️ Aucune dépendance sur pay_schedule_items pour ce mode.
      // ─────────────────────────────────────────────────────────────────────

      // Grouper les factures par fournisseur + mois
      type InvoiceGroupKey = string; // "supplierId|YYYY-MM"
      const installmentGroups = new Map<
        InvoiceGroupKey,
        { supplier_id: string; yearMonth: string; invoiceIds: string[]; totalAmount: number }
      >();

      for (const invoice of invoices) {
        const rule = rulesMap.get(invoice.supplier_id as string);
        if (!rule || rule.mode !== "installments") continue;

        const ym  = yearMonthOf(invoice.invoice_date as string);
        const key = `${invoice.supplier_id as string}|${ym}`;

        if (!installmentGroups.has(key)) {
          installmentGroups.set(key, {
            supplier_id:  invoice.supplier_id as string,
            yearMonth:    ym,
            invoiceIds:   [],
            totalAmount:  0,
          });
        }
        const g = installmentGroups.get(key)!;
        g.invoiceIds.push(invoice.id as string);
        g.totalAmount = round2(g.totalAmount + (invoice.amount_eur as number));
      }

      for (const [, group] of installmentGroups) {
        const rule = rulesMap.get(group.supplier_id);
        if (!rule || rule.mode !== "installments") continue;

        const iCount = (rule.installment_count as number | null) ?? 0;
        const iDays  = (rule.installment_days  as number[] | null) ?? [];
        if (iCount < 2 || iDays.length !== iCount || group.totalAmount <= 0) continue;

        // Calculer le total déjà payé pour ce groupe (toutes factures du mois N confondues)
        let alreadyPaidForGroup = 0;
        for (const invId of group.invoiceIds) {
          alreadyPaidForGroup = round2(alreadyPaidForGroup + (paidByInvoice.get(invId) ?? 0));
        }
        const groupRemaining = round2(Math.max(0, group.totalAmount - alreadyPaidForGroup));

        // Calculer le plan M+1
        const [yr, mo] = group.yearMonth.split("-").map(Number);
        const nextMonth = mo === 12 ? 1 : mo + 1;
        const nextYear  = mo === 12 ? yr + 1 : yr;
        const baseAmount = round2(Math.floor(group.totalAmount * 100 / iCount) / 100);

        // Construire le plan d'échéances
        const installmentPlan: Array<{ dueDate: string; amount: number }> = [];
        let planAllocated = 0;
        for (let i = 0; i < iCount; i++) {
          const day = iDays[i];
          const isLast = i === iCount - 1;
          const lastDay = new Date(nextYear, nextMonth, 0).getDate();
          const clampedDay = Math.min(day, lastDay);
          const dStr = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
          const amount = isLast ? round2(group.totalAmount - planAllocated) : baseAmount;
          if (!isLast) planAllocated = round2(planAllocated + baseAmount);
          installmentPlan.push({ dueDate: dStr, amount });
        }

        // Calculer le montant cumulatif théorique dû à today
        let cumulativeExpected = 0;
        for (const inst of installmentPlan) {
          if (inst.dueDate <= todayStr) {
            cumulativeExpected = round2(cumulativeExpected + inst.amount);
          }
        }

        // Montant qu'il reste à enregistrer = max(0, cumulatif - déjà payé)
        const toRegisterTotal = round2(Math.max(0, cumulativeExpected - alreadyPaidForGroup));
        if (toRegisterTotal <= 0.005) continue; // Déjà à jour

        // Enregistrer les échéances dues une par une (idempotence par échéance)
        // Distribuer en FIFO sur TOUTES les factures du mois (pas une seule)
        let remainingBudget = round2(Math.min(toRegisterTotal, groupRemaining));

        // Trier les factures du groupe par date (FIFO oldest first)
        const sortedGroupInvoices = group.invoiceIds
          .map((iid) => invoices.find((i) => i.id === iid))
          .filter(Boolean)
          .sort((a, b) => (a!.invoice_date as string).localeCompare(b!.invoice_date as string))
          .map((inv) => ({ id: inv!.id as string, amount_eur: inv!.amount_eur as number }));

        for (let idx = 0; idx < installmentPlan.length; idx++) {
          const inst = installmentPlan[idx];
          if (inst.dueDate > todayStr) break; // Pas encore due
          if (remainingBudget <= 0.005) break;

          // Clé idempotence par supplier + mois source + index échéance
          const baseKey = `auto-inst-${group.supplier_id}-${group.yearMonth}-${idx}`;

          // Montant pour cette échéance : min(montant_plan, restant_budget)
          const installmentAmount = round2(Math.min(inst.amount, remainingBudget));
          if (installmentAmount <= 0) continue;

          // FIFO : distribuer sur toutes les factures du mois
          const res = await createAutoPaymentFIFO(supabase, {
            organization_id,
            establishment_id,
            supplier_id:    group.supplier_id,
            sortedInvoices: sortedGroupInvoices,
            paidByInvoice,
            payment_date:   inst.dueDate,
            amount_eur:     installmentAmount,
            method:         "prelevement",
            base_key:       baseKey,
          });

          if (res.ok && res.action === "created") {
            created++;
            remainingBudget = round2(remainingBudget - installmentAmount);
            // Mettre à jour paidByInvoice pour les prochaines échéances
            let budgetToTrack = installmentAmount;
            for (const inv of sortedGroupInvoices) {
              if (budgetToTrack <= 0.005) break;
              const paid = paidByInvoice.get(inv.id) ?? 0;
              const invRemaining = round2(Math.max(0, inv.amount_eur - paid));
              if (invRemaining <= 0.005) continue;
              const allocated = round2(Math.min(budgetToTrack, invRemaining));
              paidByInvoice.set(inv.id, round2(paid + allocated));
              budgetToTrack = round2(budgetToTrack - allocated);
            }
          } else if (!res.ok) {
            errors.push(`installment ${group.supplier_id} ${group.yearMonth} idx=${idx}: ${res.error}`);
          }
        }
      }

    } catch (e) {
      console.error(`pay-auto-payments-cron: fatal error estab ${establishment_id}`, e);
      errors.push(String(e));
    }

    totalCreated += created;
    estabResults.push({ establishment_id, created, errors });

    if (created > 0 || errors.length > 0) {
      console.log(`  ${establishment_id}: created=${created}, errors=${errors.length}`);
    }
  }

  const result = {
    ok:                        true,
    date:                      todayStr,
    establishments_processed:  activeEstablishments.length,
    total_created:             totalCreated,
    results:                   estabResults,
  };

  console.log("pay-auto-payments-cron: done", result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
