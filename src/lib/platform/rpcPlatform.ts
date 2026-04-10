/**
 * ═══════════════════════════════════════════════════════════════════════════
 * rpcPlatform — Typed wrapper for platform SECURITY DEFINER RPCs
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Centralizes all `as never` casts in ONE place.
 * Frontend components import typed helpers instead of casting inline.
 *
 * SSOT for platform RPC signatures.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";

// ── Response types ──────────────────────────────────────────────────

export interface PlatformKpis {
  total_organizations: number;
  total_establishments: number;
  total_users: number;
  active_establishments: number;
  suspended_establishments: number;
}

export interface PlatformOrgRow {
  id: string;
  name: string;
  created_at: string;
  establishment_count: number;
  user_count: number;
}

export interface PlatformEstRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
  establishment_type: string;
  user_count: number;
  logo_url: string | null;
}

export interface PlatformUserRow {
  user_id: string;
  full_name: string;
  email: string;
  status: string;
  role_name: string;
  role_names: string[];
}

export interface PlatformModuleRow {
  key: string;
  name: string;
  description: string | null;
  status: string;
  establishments_using: number;
  organizations_using: number;
}

export interface PlatformEstablishmentProfile {
  establishment_id: string;
  establishment_type: string;
  legal_name: string | null;
  siret: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImpersonationResult {
  ok: boolean;
  error?: string;
  session_id?: string;
  target_role_name?: string;
}

export interface CreateOrgWizardPayload {
  org_name: string;
  org_type?: string;
  est_name: string;
  est_type: string;
  profile: {
    legal_name?: string;
    siret?: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    address_line1?: string;
    address_line2?: string;
    postal_code?: string;
    city?: string;
    country?: string;
    logo_url?: string;
  };
  modules?: string[];
}

export interface CreateOrgWizardResult {
  ok: boolean;
  error?: string;
  organization_id?: string;
  establishment_id?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Parse RPC response that may be a string (jsonb) or already parsed */
function parseJsonb<T>(data: unknown): T {
  if (typeof data === "string") return JSON.parse(data) as T;
  return data as T;
}

// ── RPC wrappers ────────────────────────────────────────────────────

export async function platformGetKpis(): Promise<PlatformKpis> {
  const { data, error } = await supabase.rpc("platform_get_kpis" as never);
  if (error) throw error;
  return parseJsonb<PlatformKpis>(data);
}

export async function platformListOrganizations(): Promise<PlatformOrgRow[]> {
  const { data, error } = await supabase.rpc("platform_list_organizations" as never);
  if (error) throw error;
  return parseJsonb<PlatformOrgRow[]>(data) ?? [];
}

export async function platformListEstablishments(orgId: string): Promise<PlatformEstRow[]> {
  const { data, error } = await supabase.rpc(
    "platform_list_establishments" as never,
    { _org_id: orgId } as never
  );
  if (error) throw error;
  return parseJsonb<PlatformEstRow[]>(data) ?? [];
}

export async function platformListEstablishmentUsers(estId: string): Promise<PlatformUserRow[]> {
  const { data, error } = await supabase.rpc(
    "platform_list_establishment_users" as never,
    { _establishment_id: estId } as never
  );
  if (error) throw error;
  return parseJsonb<PlatformUserRow[]>(data) ?? [];
}

export async function platformListModules(): Promise<PlatformModuleRow[]> {
  const { data, error } = await supabase.rpc("platform_list_modules" as never);
  if (error) throw error;
  return parseJsonb<PlatformModuleRow[]>(data) ?? [];
}

export async function platformGetEstablishmentProfile(
  estId: string
): Promise<PlatformEstablishmentProfile | null> {
  const { data, error } = await supabase.rpc(
    "platform_get_establishment_profile" as never,
    { p_establishment_id: estId } as never
  );
  if (error) throw error;
  const parsed = parseJsonb<PlatformEstablishmentProfile & { exists?: boolean }>(data);
  if (!parsed || parsed.exists === false) return null;
  return parsed;
}

export async function platformUpsertEstablishmentProfile(
  estId: string,
  payload: Record<string, string>
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc(
    "platform_upsert_establishment_profile" as never,
    { p_establishment_id: estId, p_payload: payload } as never
  );
  if (error) throw error;
  const result = parseJsonb<{ ok: boolean; error?: string }>(data);
  if (!result?.ok) throw new Error(result?.error ?? "Erreur inconnue");
  return result;
}

export async function platformStartImpersonation(
  targetUserId: string,
  targetEstablishmentId: string
): Promise<ImpersonationResult> {
  const { data, error } = await supabase.rpc("start_impersonation" as never, {
    _target_user_id: targetUserId,
    _target_establishment_id: targetEstablishmentId,
  } as never);
  if (error) throw new Error(error.message);
  const result = data as ImpersonationResult;
  if (!result.ok) throw new Error(result.error ?? "Unknown error");
  return result;
}

export async function platformStopImpersonation(): Promise<ImpersonationResult> {
  const { data, error } = await supabase.rpc("stop_impersonation" as never);
  if (error) throw new Error(error.message);
  const result = data as ImpersonationResult;
  if (!result.ok) throw new Error(result.error ?? "Unknown error");
  return result;
}

export async function platformCreateOrganizationWizard(
  payload: CreateOrgWizardPayload
): Promise<CreateOrgWizardResult> {
  const { data, error } = await supabase.rpc(
    "platform_create_organization_wizard" as never,
    { p_payload: payload } as never
  );
  if (error) throw new Error(error.message);
  const result = parseJsonb<CreateOrgWizardResult>(data);
  if (!result?.ok) throw new Error(result?.error ?? "Erreur inconnue");
  return result;
}

export async function platformRenameOrganization(
  orgId: string,
  newName: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc(
    "platform_rename_organization" as never,
    { _org_id: orgId, _new_name: newName } as never
  );
  if (error) throw new Error(error.message);
  const result = parseJsonb<{ ok: boolean; error?: string }>(data);
  if (!result?.ok) throw new Error(result?.error ?? "Erreur inconnue");
  return result;
}

export async function platformDeleteOrganization(
  orgId: string
): Promise<{ ok: boolean; deleted_org?: string; error?: string }> {
  const { data, error } = await supabase.rpc(
    "platform_delete_organization" as never,
    { _org_id: orgId } as never
  );
  if (error) throw new Error(error.message);
  const result = parseJsonb<{ ok: boolean; deleted_org?: string; error?: string }>(data);
  if (!result?.ok) throw new Error(result?.error ?? "Erreur inconnue");
  return result;
}
