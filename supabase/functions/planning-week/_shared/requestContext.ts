/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Request Context Cache — In-request memoization (0 risk)
 * 
 * STEP 2 — Eliminates duplicate DB roundtrips within a single request.
 * Each getter fetches once, then returns cached value.
 * 
 * Cache lifetime = single request (no cross-request pollution).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

type AnyClient = SupabaseClient;

interface EstablishmentData {
  id: string;
  name: string;
  organization_id: string;
  planning_auto_publish_enabled: boolean;
  planning_auto_publish_time: string;
}

interface PermissionsData {
  is_admin: boolean;
  permissions: Array<{ module_key: string; access_level: string; scope: string }>;
  team_ids: string[];
  establishment_ids: string[];
}

export class RequestContext {
  private cache = new Map<string, unknown>();

  constructor(
    private userClient: AnyClient,
    private adminClient: AnyClient,
    private userId: string
  ) {}

  /** Get organization ID (cached) */
  async getOrgId(): Promise<string> {
    const key = "orgId";
    if (this.cache.has(key)) return this.cache.get(key) as string;

    const { data, error } = await this.userClient.rpc("get_user_organization_id");
    if (error || !data) throw new Error("Organization not found");
    this.cache.set(key, data as string);
    return data as string;
  }

  /** Get establishment data (cached) — single fetch includes auto-publish fields */
  async getEstablishment(establishmentId: string): Promise<EstablishmentData> {
    const key = `establishment:${establishmentId}`;
    if (this.cache.has(key)) return this.cache.get(key) as EstablishmentData;

    const { data, error } = await this.adminClient
      .from("establishments")
      .select("id, name, organization_id, planning_auto_publish_enabled, planning_auto_publish_time")
      .eq("id", establishmentId)
      .single();

    if (error || !data) throw new Error("Establishment not found");
    this.cache.set(key, data as EstablishmentData);
    return data as EstablishmentData;
  }

  /** Get permissions for establishment (cached) */
  async getPermissions(establishmentId: string): Promise<PermissionsData> {
    const key = `permissions:${establishmentId}`;
    if (this.cache.has(key)) return this.cache.get(key) as PermissionsData;

    const { data } = await this.userClient.rpc("get_my_permissions_v2", {
      _establishment_id: establishmentId,
    });

    const result: PermissionsData = {
      is_admin: data?.is_admin ?? false,
      permissions: data?.permissions ?? [],
      team_ids: data?.team_ids ?? [],
      establishment_ids: data?.establishment_ids ?? [],
    };
    this.cache.set(key, result);
    return result;
  }

  /** Get planning permission shortcut */
  async getPlanningPermission(establishmentId: string): Promise<{
    accessLevel: string;
    scope: string;
    teamIds: string[];
    isAdmin: boolean;
  }> {
    const perms = await this.getPermissions(establishmentId);
    const planningPerm = perms.permissions.find(p => p.module_key === "planning");
    return {
      accessLevel: planningPerm?.access_level || "none",
      scope: planningPerm?.scope || "self",
      teamIds: perms.team_ids,
      isAdmin: perms.is_admin,
    };
  }

  /** Check module access (cached) */
  async hasModuleAccess(moduleKey: string, minLevel: string, establishmentId: string): Promise<boolean> {
    const key = `access:${moduleKey}:${minLevel}:${establishmentId}`;
    if (this.cache.has(key)) return this.cache.get(key) as boolean;

    const { data } = await this.userClient.rpc("has_module_access", {
      _module_key: moduleKey,
      _min_level: minLevel,
      _establishment_id: establishmentId,
    });

    const result = !!data;
    this.cache.set(key, result);
    return result;
  }

  /** Get break policy (cached) */
  async getBreakPolicy(establishmentId: string): Promise<{ id: string; policy_json: unknown } | null> {
    const key = `breakPolicy:${establishmentId}`;
    if (this.cache.has(key)) return this.cache.get(key) as { id: string; policy_json: unknown } | null;

    const { data: policies } = await this.adminClient
      .from("establishment_break_policies")
      .select("id, policy_json")
      .eq("establishment_id", establishmentId)
      .eq("is_active", true);

    if (!policies || policies.length === 0) {
      this.cache.set(key, null);
      return null;
    }
    if (policies.length > 1) {
      throw new Error("Multiple active break policies");
    }
    const result = { id: policies[0].id, policy_json: policies[0].policy_json };
    this.cache.set(key, result);
    return result;
  }

  /** Get day parts (cached) */
  async getDayParts(establishmentId: string): Promise<Array<{ part: string; start_time: string; end_time: string; color: string }>> {
    const key = `dayParts:${establishmentId}`;
    if (this.cache.has(key)) return this.cache.get(key) as Array<{ part: string; start_time: string; end_time: string; color: string }>;

    const { data } = await this.adminClient
      .from("establishment_day_parts")
      .select("part, start_time, end_time, color")
      .eq("establishment_id", establishmentId);

    const result = data || [];
    this.cache.set(key, result);
    return result;
  }
}
