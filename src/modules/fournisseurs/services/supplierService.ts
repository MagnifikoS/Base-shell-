/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FOURNISSEURS — Supplier Service (Security Hardened)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SSOT pour les opérations CRUD sur les fournisseurs.
 *
 * ⚠️ SÉCURITÉ — POLITIQUE DE SUPPRESSION:
 * - archiveSupplier() = SOFT DELETE (recommandé, réversible)
 * - deleteSupplierHard() = HARD DELETE (irréversible, 2 confirmations requises)
 * - Voir docs/data-deletion-policy.md pour les règles complètes
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";

export interface Supplier {
  id: string;
  name: string;
  name_normalized: string | null;
  trade_name: string | null;
  supplier_type: string | null;
  siret: string | null;
  vat_number: string | null;
  internal_code: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  billing_address: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  payment_terms: string | null;
  payment_delay_days: number | null;
  payment_method: string | null;
  currency: string | null;
  logo_url: string | null;
  tags: string[] | null;
  status: string;
  establishment_id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface SupplierInput {
  name: string;
  trade_name?: string | null;
  supplier_type?: string | null;
  siret?: string | null;
  vat_number?: string | null;
  internal_code?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
  billing_address?: string | null;
  address_line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
  payment_terms?: string | null;
  payment_delay_days?: number | null;
  payment_method?: string | null;
  currency?: string | null;
  tags?: string[] | null;
}

interface CreateSupplierParams extends SupplierInput {
  establishment_id: string;
  organization_id: string;
}

interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Create a new supplier
 */
export async function createSupplier(
  params: CreateSupplierParams
): Promise<ServiceResult<Supplier>> {
  try {
    const { data, error } = await supabase
      .from("invoice_suppliers")
      .insert({
        name: params.name,
        trade_name: params.trade_name,
        supplier_type: params.supplier_type,
        siret: params.siret,
        vat_number: params.vat_number,
        internal_code: params.internal_code,
        contact_name: params.contact_name,
        contact_email: params.contact_email,
        contact_phone: params.contact_phone,
        notes: params.notes,
        billing_address: params.billing_address,
        address_line2: params.address_line2,
        postal_code: params.postal_code,
        city: params.city,
        country: params.country,
        payment_terms: params.payment_terms,
        payment_delay_days: params.payment_delay_days,
        payment_method: params.payment_method,
        currency: params.currency || "EUR",
        tags: params.tags,
        establishment_id: params.establishment_id,
        organization_id: params.organization_id,
        status: "active",
      })
      .select()
      .single();

    if (error) {
      if (import.meta.env.DEV) console.error("[createSupplier] Error:", error);
      if (error.code === "23505") {
        return { success: false, error: "Un fournisseur avec ce nom existe déjà" };
      }
      return { success: false, error: error.message };
    }

    return { success: true, data: data as Supplier };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[createSupplier] Exception:", err);
    return { success: false, error: "Erreur lors de la création du fournisseur" };
  }
}

/**
 * Update an existing supplier
 */
export async function updateSupplier(
  supplierId: string,
  updates: Partial<SupplierInput>
): Promise<ServiceResult<Supplier>> {
  try {
    const { data, error } = await supabase
      .from("invoice_suppliers")
      .update(updates)
      .eq("id", supplierId)
      .select()
      .single();

    if (error) {
      if (import.meta.env.DEV) console.error("[updateSupplier] Error:", error);
      if (error.code === "23505") {
        return { success: false, error: "Un fournisseur avec ce nom existe déjà" };
      }
      return { success: false, error: error.message };
    }

    return { success: true, data: data as Supplier };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[updateSupplier] Exception:", err);
    return { success: false, error: "Erreur lors de la mise à jour du fournisseur" };
  }
}

/**
 * Archive a supplier (soft delete) + archive all linked products
 */
export async function archiveSupplier(supplierId: string): Promise<ServiceResult<void>> {
  try {
    // Archive all linked products first
    const { error: productsError } = await supabase
      .from("supplier_extracted_products")
      .update({ archived_at: new Date().toISOString() })
      .eq("supplier_id", supplierId)
      .is("archived_at", null);

    if (productsError) {
      if (import.meta.env.DEV) console.error("[archiveSupplier] Products error:", productsError);
      return { success: false, error: productsError.message };
    }

    // Archive the supplier
    const { error } = await supabase
      .from("invoice_suppliers")
      .update({
        archived_at: new Date().toISOString(),
        status: "archived",
      })
      .eq("id", supplierId);

    if (error) {
      if (import.meta.env.DEV) console.error("[archiveSupplier] Error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[archiveSupplier] Exception:", err);
    return { success: false, error: "Erreur lors de l'archivage du fournisseur" };
  }
}

/**
 * Get count of linked products for a supplier
 */
export async function getSupplierProductsCount(supplierId: string): Promise<ServiceResult<number>> {
  try {
    const { count, error } = await supabase
      .from("supplier_extracted_products")
      .select("*", { count: "exact", head: true })
      .eq("supplier_id", supplierId)
      .is("archived_at", null);

    if (error) {
      if (import.meta.env.DEV) console.error("[getSupplierProductsCount] Error:", error);
      return { success: false, error: error.message };
    }

    return { success: true, data: count ?? 0 };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[getSupplierProductsCount] Exception:", err);
    return { success: false, error: "Erreur lors du comptage des produits" };
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ SECURITY: HARD DELETE OPERATION — DONNÉES CRITIQUES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Suppression DÉFINITIVE d'un fournisseur et tous ses produits liés.
 *
 * RÈGLES DE SÉCURITÉ:
 * - NE JAMAIS appeler sans confirmation utilisateur explicite via UI
 * - NE JAMAIS utiliser pour du nettoyage batch ou script
 * - NE JAMAIS appeler depuis une migration ou un cron job
 * - TOUJOURS afficher un dialog de double confirmation AVANT l'appel
 *
 * CONTEXTE AUTORISÉ:
 * - Appel depuis SupplierDeleteDialog après double confirmation AlertDialog
 *
 * @see docs/data-deletion-policy.md
 */
export async function deleteSupplierHard(supplierId: string): Promise<ServiceResult<void>> {
  try {
    // SEC-DATA-031: Audit log BEFORE deletion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("audit_logs") as any).insert({
      action: "hard_delete:invoice_suppliers",
      target_type: "invoice_suppliers",
      target_id: supplierId,
      organization_id: null,
      metadata: {
        table: "invoice_suppliers",
        cascade: ["supplier_extracted_products"],
        reason: "User-initiated supplier hard deletion via UI",
      },
    });

    // Delete all linked products first (hard delete)
    const { error: productsError } = await supabase
      .from("supplier_extracted_products")
      .delete()
      .eq("supplier_id", supplierId);

    if (productsError) {
      if (import.meta.env.DEV) console.error("[deleteSupplierHard] Products error:", productsError);
      return { success: false, error: productsError.message };
    }

    // Delete the supplier (hard delete)
    const { error } = await supabase.from("invoice_suppliers").delete().eq("id", supplierId);

    if (error) {
      if (import.meta.env.DEV) console.error("[deleteSupplierHard] Error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[deleteSupplierHard] Exception:", err);
    return { success: false, error: "Erreur lors de la suppression définitive" };
  }
}

/**
 * Get a supplier by ID
 */
export async function getSupplierById(supplierId: string): Promise<ServiceResult<Supplier>> {
  try {
    const { data, error } = await supabase
      .from("invoice_suppliers")
      .select(
        "id, name, name_normalized, trade_name, supplier_type, siret, vat_number, internal_code, contact_name, contact_email, contact_phone, notes, billing_address, address_line2, postal_code, city, country, payment_terms, payment_delay_days, payment_method, currency, tags, status, establishment_id, organization_id, created_at, updated_at, archived_at, logo_url"
      )
      .eq("id", supplierId)
      .single();

    if (error) {
      if (import.meta.env.DEV) console.error("[getSupplierById] Error:", error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data as Supplier };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[getSupplierById] Exception:", err);
    return { success: false, error: "Erreur lors de la récupération du fournisseur" };
  }
}
