/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Facture App Service — All Supabase calls for app-generated invoices
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import type { AppInvoice, AppInvoiceLine, AppInvoiceWithLines } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── List app invoices for an establishment (supplier OR client) ──

export async function getAppInvoices(establishmentId: string): Promise<AppInvoice[]> {
  const { data, error } = await db
    .from("app_invoices")
    .select("*")
    .or(
      `supplier_establishment_id.eq.${establishmentId},client_establishment_id.eq.${establishmentId}`
    )
    .order("invoice_date", { ascending: false });

  if (error) throw error;
  return (data ?? []) as AppInvoice[];
}

// ── Get invoice with lines ──

export async function getAppInvoiceWithLines(invoiceId: string): Promise<AppInvoiceWithLines> {
  const { data: invoice, error } = await db
    .from("app_invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (error) throw error;

  const { data: lines, error: linesError } = await db
    .from("app_invoice_lines")
    .select("*")
    .eq("app_invoice_id", invoiceId)
    .order("created_at", { ascending: true });

  if (linesError) throw linesError;

  return {
    ...(invoice as AppInvoice),
    lines: (lines ?? []) as AppInvoiceLine[],
  };
}

// ── Check if a commande already has an invoice ──

export async function getInvoiceForCommande(commandeId: string): Promise<AppInvoice | null> {
  const { data, error } = await db
    .from("app_invoices")
    .select("*")
    .eq("commande_id", commandeId)
    .maybeSingle();

  if (error) throw error;
  return (data as AppInvoice) ?? null;
}

// ── Generate invoice (calls SECURITY DEFINER RPC) ──

export interface GenerateInvoiceResult {
  ok: boolean;
  error?: string;
  invoice_id?: string;
  invoice_number?: string;
  total_ht?: number;
  line_count?: number;
  count?: number;
  existing_invoice_id?: string;
  current_status?: string;
}

export async function generateAppInvoice(
  commandeId: string,
  userId: string
): Promise<GenerateInvoiceResult> {
  const { data, error } = await db.rpc("fn_generate_app_invoice", {
    p_commande_id: commandeId,
    p_user_id: userId,
  });

  if (error) throw error;
  return data as GenerateInvoiceResult;
}
