/**
 * Data-fetch guards (risk-0)
 * Use these to prevent React Query from fetching unauthorized data
 */

import type { UserPermissions } from "./permissions";
import { hasAccess } from "./permissions";

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

/**
 * Assert user has read access to a module
 * Throws PermissionError if not authorized
 */
export function assertModuleRead(
  perms: UserPermissions | null,
  moduleKey: string
): void {
  if (!hasAccess(perms, moduleKey, "read")) {
    throw new PermissionError(`No read access to module: ${moduleKey}`);
  }
}

/**
 * Assert user has write access to a module
 * Throws PermissionError if not authorized
 */
export function assertModuleWrite(
  perms: UserPermissions | null,
  moduleKey: string
): void {
  if (!hasAccess(perms, moduleKey, "write")) {
    throw new PermissionError(`No write access to module: ${moduleKey}`);
  }
}

/**
 * Check read access without throwing (for React Query enabled)
 */
export function canFetchModule(
  perms: UserPermissions | null,
  moduleKey: string
): boolean {
  return hasAccess(perms, moduleKey, "read");
}

/**
 * Check write access without throwing
 */
export function canMutateModule(
  perms: UserPermissions | null,
  moduleKey: string
): boolean {
  return hasAccess(perms, moduleKey, "write");
}
