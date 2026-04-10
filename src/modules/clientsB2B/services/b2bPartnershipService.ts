/**
 * B2B Partnership Service — Supabase calls for partnerships & invitation codes
 */

import { supabase } from "@/integrations/supabase/client";

// ── Types ──

export interface B2BPartnership {
  id: string;
  supplier_establishment_id: string;
  client_establishment_id: string;
  status: "active" | "archived";
  share_stock: boolean;
  created_at: string;
  archived_at: string | null;
  archived_by: string | null;
}

export interface B2BInvitationCode {
  id: string;
  code: string;
  supplier_establishment_id: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_establishment_id: string | null;
  partnership_id: string | null;
}

export interface PartnerProfile {
  ok: boolean;
  error?: string;
  name?: string;
  trade_name?: string | null;
  establishment_type?: string;
  logo_url?: string | null;
  legal_name?: string | null;
  city?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  siret?: string | null;
}

export interface RedeemResult {
  ok: boolean;
  error?: string;
  partnership_id?: string;
}

// ── Partnerships ──

export async function getMyPartnerships(establishmentId: string): Promise<B2BPartnership[]> {
  const { data, error } = await supabase
    .from("b2b_partnerships")
    .select("*")
    .or(
      `supplier_establishment_id.eq.${establishmentId},client_establishment_id.eq.${establishmentId}`
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as B2BPartnership[];
}

export async function archivePartnership(
  partnershipId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("b2b_partnerships")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
      archived_by: userId,
    })
    .eq("id", partnershipId);

  if (error) throw error;
}

// ── Invitation Codes ──

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function createInvitationCode(
  supplierEstablishmentId: string,
  userId: string
): Promise<B2BInvitationCode> {
  const code = generateCode();

  const { data, error } = await supabase
    .from("b2b_invitation_codes")
    .insert({
      code,
      supplier_establishment_id: supplierEstablishmentId,
      created_by: userId,
    })
    .select()
    .single();

  if (error) throw error;
  return data as B2BInvitationCode;
}

export async function getMyInvitationCodes(
  supplierEstablishmentId: string
): Promise<B2BInvitationCode[]> {
  const { data, error } = await supabase
    .from("b2b_invitation_codes")
    .select("*")
    .eq("supplier_establishment_id", supplierEstablishmentId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as B2BInvitationCode[];
}

// ── Redeem Code (RPC) ──

export async function redeemCode(
  code: string,
  clientEstablishmentId: string
): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc("fn_redeem_b2b_code", {
    p_code: code.toUpperCase().trim(),
    p_client_establishment_id: clientEstablishmentId,
  });

  if (error) throw error;
  return data as unknown as RedeemResult;
}

// ── Partner Profile (RPC) ──

export async function getPartnerProfile(
  partnerEstablishmentId: string
): Promise<PartnerProfile> {
  const { data, error } = await supabase.rpc("fn_get_b2b_partner_profile", {
    p_partner_establishment_id: partnerEstablishmentId,
  });

  if (error) throw error;
  return data as unknown as PartnerProfile;
}
