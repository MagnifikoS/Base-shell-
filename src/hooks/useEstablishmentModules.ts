/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useEstablishmentModules — Query enabled/disabled modules for an establishment
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CONVENTION: 0 rows in platform_establishment_module_selections = ALL enabled
 * This protects AMIR and all legacy establishments.
 *
 * Returns:
 *  - null when no rows exist (all enabled — backward compatible)
 *  - Set<string> of DISABLED module keys when rows exist
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface EstablishmentModulesResult {
  /** null = all enabled (AMIR mode), Set = disabled module keys */
  disabledModules: Set<string> | null;
  /** null = all enabled, Set = explicitly enabled module keys */
  enabledModules: Set<string> | null;
  /** true if rows exist in the selections table */
  hasExplicitConfig: boolean;
  isLoading: boolean;
}

export function useEstablishmentModules(
  establishmentId: string | null | undefined
): EstablishmentModulesResult {
  const { data, isLoading } = useQuery({
    queryKey: ["establishment-modules", establishmentId],
    queryFn: async () => {
      if (!establishmentId) {
        return {
          selections: [] as { module_key: string; enabled: boolean }[],
          allModuleKeys: [] as string[],
        };
      }

      const [selectionsRes, modulesRes] = await Promise.all([
        supabase
          .from("platform_establishment_module_selections")
          .select("module_key, enabled")
          .eq("establishment_id", establishmentId),
        supabase.from("modules").select("key"),
      ]);

      if (selectionsRes.error) throw selectionsRes.error;
      if (modulesRes.error) throw modulesRes.error;

      return {
        selections: selectionsRes.data ?? [],
        allModuleKeys: (modulesRes.data ?? []).map((m) => m.key),
      };
    },
    enabled: !!establishmentId,
    staleTime: 5 * 60 * 1000, // 5 min cache — module config rarely changes
  });

  if (!data || data.selections.length === 0) {
    return {
      disabledModules: null,
      enabledModules: null,
      hasExplicitConfig: false,
      isLoading,
    };
  }

  const disabled = new Set<string>();
  const enabled = new Set<string>();

  for (const row of data.selections) {
    if (row.enabled) {
      enabled.add(row.module_key);
    } else {
      disabled.add(row.module_key);
    }
  }

  // Sparse config support: if explicit config exists, missing module keys are considered disabled.
  for (const moduleKey of data.allModuleKeys) {
    if (!enabled.has(moduleKey)) {
      disabled.add(moduleKey);
    }
  }

  return {
    disabledModules: disabled,
    enabledModules: enabled,
    hasExplicitConfig: true,
    isLoading,
  };
}
