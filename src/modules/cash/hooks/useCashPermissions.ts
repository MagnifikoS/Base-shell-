/**
 * Hook to determine user's cash permission level
 * Uses the existing permission system with caisse_day/caisse_month scopes
 */

import { useMemo } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import type { CashPermissionLevel } from '../utils/types';

export function useCashPermissions() {
  const { data, isLoading, isAdmin, getScope, can } = usePermissions();

  const permissionLevel = useMemo<CashPermissionLevel>(() => {
    if (isAdmin) return 'admin';
    if (!data) return 'none';

    // Check if user has any access to caisse
    const hasAccess = can('caisse', 'read');
    if (!hasAccess) return 'none';

    // Get the scope for caisse module
    const scope = getScope('caisse');

    // Determine scope-based permission level
    // caisse_month or org allows full month access
    // caisse_day, establishment, team, self allows only today's business day
    if (scope === 'caisse_month' || scope === 'org') {
      return 'caisse_month';
    }
    
    // Default to caisse_day for other scopes
    return 'caisse_day';
  }, [data, isAdmin, getScope, can]);

  const canWrite = useMemo(() => {
    if (isAdmin) return true;
    return can('caisse', 'write');
  }, [isAdmin, can]);

  const canRead = useMemo(() => {
    return permissionLevel !== 'none';
  }, [permissionLevel]);

  const canAccessMonth = useMemo(() => {
    return permissionLevel === 'admin' || permissionLevel === 'caisse_month';
  }, [permissionLevel]);

  return {
    permissionLevel,
    canWrite,
    canRead,
    canAccessMonth,
    isLoading,
    isAdmin,
  };
}
