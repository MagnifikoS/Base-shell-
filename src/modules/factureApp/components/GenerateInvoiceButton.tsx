/**
 * GenerateInvoiceButton — Shows "Générer facture" on commande detail
 * Only visible for supplier when commande is "recue" (no invoice yet).
 * After generation, RPC atomically transitions commande to "cloturee".
 * Emits a "commande_facturee" notification to the client.
 */

import { useState } from "react";
import { FileText, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useGenerateAppInvoice, useInvoiceForCommande } from "../hooks/useFactureApp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Props {
  commandeId: string;
  commandeStatus: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  commande_not_found: "Commande introuvable",
  commande_not_received: "La commande n'est pas encore réceptionnée",
  open_litiges: "Un litige est encore en cours sur cette commande",
  missing_price_snapshot: "Des lignes n'ont pas de prix figé — commande non facturable",
  invoice_already_exists: "Une facture existe déjà pour cette commande",
  all_lines_zero: "Aucune ligne réceptionnée à facturer",
};

/** Fire-and-forget: notify the client that an invoice is available */
async function emitInvoiceNotification(commandeId: string, invoiceNumber: string) {
  try {
    const { data: commande } = await db
      .from("commandes")
      .select("id, client_establishment_id, created_by, order_number")
      .eq("id", commandeId)
      .single();
    if (!commande) return;

    const { data: rule } = await db
      .from("notification_rules")
      .select("id")
      .eq("alert_type", "commande_facturee")
      .limit(1)
      .maybeSingle();
    if (!rule) return;

    // Notify the order creator + all client establishment members
    const { data: members } = await db
      .from("user_establishments")
      .select("user_id")
      .eq("establishment_id", commande.client_establishment_id);

    const recipientIds = new Set<string>([commande.created_by]);
    (members ?? []).forEach((m: { user_id: string }) => recipientIds.add(m.user_id));

    const events = [...recipientIds].map((uid) => ({
      rule_id: rule.id,
      establishment_id: commande.client_establishment_id,
      alert_key: `commande_facturee:${commandeId}:${uid}`,
      alert_type: "commande_facturee",
      recipient_user_id: uid,
      payload: {
        title: "Facture disponible",
        body: `La facture ${invoiceNumber} de la commande ${commande.order_number ?? ""} est disponible`,
        commande_id: commandeId,
      },
    }));

    await db.from("notification_events").insert(events);
  } catch {
    // Non-blocking — don't fail the invoice flow
  }
}

export function GenerateInvoiceButton({ commandeId, commandeStatus }: Props) {
  const generate = useGenerateAppInvoice();
  const { data: existingInvoice, isLoading: checkingExisting } = useInvoiceForCommande(commandeId);
  const [isGenerating, setIsGenerating] = useState(false);

  const isFacturable = commandeStatus === "recue";

  if (!isFacturable) return null;
  if (checkingExisting) return null;

  // If invoice already exists, show a read-only indicator
  if (existingInvoice) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 border">
        <Check className="h-3.5 w-3.5 text-emerald-600" />
        <span>
          Facture <span className="font-medium text-foreground">{existingInvoice.invoice_number}</span> générée
        </span>
      </div>
    );
  }

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const result = await generate.mutateAsync(commandeId);
      if (result.ok) {
        toast.success(`Facture ${result.invoice_number} générée`);
        // Emit notification to client (fire-and-forget)
        emitInvoiceNotification(commandeId, result.invoice_number ?? "");
      } else {
        const msg = ERROR_MESSAGES[result.error ?? ""] ?? result.error ?? "Erreur inconnue";
        toast.error(msg);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la génération");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleGenerate}
      disabled={isGenerating}
      className="gap-1.5"
    >
      {isGenerating ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FileText className="h-3.5 w-3.5" />
      )}
      Générer facture
    </Button>
  );
}
