/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOBILE NAV PREFERENCES — localStorage-only visibility prefs
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module manages user preferences for mobile navigation visibility.
 * It does NOT grant any access — it only filters what is displayed:
 *
 * VISIBLE = RBAC_ALLOWED ∩ USER_PREFS
 *
 * RULES:
 * - localStorage only (zero backend, zero DB)
 * - Scoped by userId only (SSOT Auth — no orgId dependency)
 * - If userId is null → return empty prefs
 * - If id is not in registry → cleaned automatically on load
 * - Deleting localStorage → reverts to default (all allowed items visible)
 *
 * KEY FORMAT: mobile_nav_prefs_v1::<userId>
 *
 * MIGRATION: Automatically migrates old keys (mobile_nav_prefs_v1::<orgId>::<userId>)
 * to the new format on first load.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { NAV_REGISTRY } from "@/config/navRegistry";

const STORAGE_KEY_PREFIX = "mobile_nav_prefs_v1";

/**
 * Mobile navigation preferences schema
 */
export interface MobileNavPrefs {
  /** IDs of items hidden by user preference */
  hiddenIds: string[];
}

/**
 * Default empty preferences
 */
const DEFAULT_PREFS: MobileNavPrefs = {
  hiddenIds: [],
};

/**
 * Get the storage key scoped by user only (new format)
 */
function getStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}::${userId}`;
}

/**
 * Validate that an id exists in the registry (including children)
 */
function isValidNavId(id: string): boolean {
  for (const item of NAV_REGISTRY) {
    // Check parent
    if (item.id === id) return true;
    // Check children
    if (item.children) {
      for (const child of item.children) {
        if (child.id === id) return true;
      }
    }
  }
  return false;
}

/**
 * Migrate old org-scoped keys to new user-only format.
 * Scans localStorage for keys matching: mobile_nav_prefs_v1::<anything>::<userId>
 * If found, imports value to new key and removes old key.
 * Idempotent and silent (no logs, no side effects if nothing to migrate).
 */
function migrateOldKey(userId: string): MobileNavPrefs | null {
  try {
    const newKey = getStorageKey(userId);

    // Scan localStorage for old format keys ending with ::<userId>
    const oldKeySuffix = `::${userId}`;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // Match old format: mobile_nav_prefs_v1::<orgId>::<userId>
      // Must start with prefix, have 3 parts (prefix::orgId::userId), and end with userId
      if (
        key.startsWith(`${STORAGE_KEY_PREFIX}::`) &&
        key.endsWith(oldKeySuffix) &&
        key !== newKey // Don't match the new key format
      ) {
        const parts = key.split("::");
        // Old format has 3 parts: [prefix, orgId, userId]
        if (parts.length === 3) {
          const raw = localStorage.getItem(key);
          if (raw) {
            // Import to new key
            localStorage.setItem(newKey, raw);
            // Remove old key
            localStorage.removeItem(key);
            // Parse and return the migrated prefs
            const parsed = JSON.parse(raw) as MobileNavPrefs;
            const validHiddenIds = (parsed.hiddenIds || []).filter(isValidNavId);
            return { hiddenIds: validHiddenIds };
          }
        }
      }
    }

    return null;
  } catch {
    // Silent failure — no migration performed
    return null;
  }
}

/**
 * Load mobile nav preferences for a user
 *
 * @param _orgId - DEPRECATED: kept for API compatibility, ignored
 * @param userId - The user's ID (null returns empty prefs)
 * @returns The user's preferences or default empty prefs (cleaned of unknown IDs)
 */
export function loadMobileNavPrefs(_orgId: string | null, userId: string | null): MobileNavPrefs {
  if (!userId) {
    return { ...DEFAULT_PREFS };
  }

  try {
    const newKey = getStorageKey(userId);
    const raw = localStorage.getItem(newKey);

    // If no data in new key, try to migrate from old format
    if (!raw) {
      const migrated = migrateOldKey(userId);
      if (migrated) {
        return migrated;
      }
      return { ...DEFAULT_PREFS };
    }

    const parsed = JSON.parse(raw) as MobileNavPrefs;

    // Filter out any invalid IDs (cleanup stale entries)
    const validHiddenIds = (parsed.hiddenIds || []).filter(isValidNavId);

    return { hiddenIds: validHiddenIds };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Save mobile nav preferences for a user
 *
 * @param _orgId - DEPRECATED: kept for API compatibility, ignored
 * @param userId - The user's ID (null does nothing)
 * @param prefs - The preferences to save
 */
export function saveMobileNavPrefs(
  _orgId: string | null,
  userId: string | null,
  prefs: MobileNavPrefs
): void {
  if (!userId) {
    return;
  }

  try {
    // Filter out any invalid IDs before saving
    const validPrefs: MobileNavPrefs = {
      hiddenIds: (prefs.hiddenIds || []).filter(isValidNavId),
    };

    localStorage.setItem(getStorageKey(userId), JSON.stringify(validPrefs));
  } catch {
    // Silent failure
  }
}

/**
 * Toggle visibility of a nav item for a user
 *
 * @param _orgId - DEPRECATED: kept for API compatibility, ignored
 * @param userId - The user's ID (null returns empty prefs)
 * @param id - The nav item ID to toggle
 * @returns The updated preferences
 */
export function toggleMobileNavHidden(
  _orgId: string | null,
  userId: string | null,
  id: string
): MobileNavPrefs {
  if (!userId) {
    return { ...DEFAULT_PREFS };
  }

  // Ignore invalid IDs
  if (!isValidNavId(id)) {
    return loadMobileNavPrefs(null, userId);
  }

  const current = loadMobileNavPrefs(null, userId);
  const isCurrentlyHidden = current.hiddenIds.includes(id);

  const newPrefs: MobileNavPrefs = {
    hiddenIds: isCurrentlyHidden
      ? current.hiddenIds.filter((hid) => hid !== id)
      : [...current.hiddenIds, id],
  };

  saveMobileNavPrefs(null, userId, newPrefs);
  return newPrefs;
}

/**
 * Clear all preferences for a user (reset to default)
 *
 * @param _orgId - DEPRECATED: kept for API compatibility, ignored
 * @param userId - The user's ID (null does nothing)
 */
export function clearMobileNavPrefs(_orgId: string | null, userId: string | null): void {
  if (!userId) {
    return;
  }

  try {
    localStorage.removeItem(getStorageKey(userId));
  } catch {
    // Silent failure
  }
}
