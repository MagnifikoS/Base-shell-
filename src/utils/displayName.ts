/**
 * Strip accents and uppercase a product name for display purposes.
 * Does NOT modify the stored value.
 */
export function displayProductName(name: string): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

/**
 * Normalize a product name for INPUT / PERSISTENCE:
 * uppercase + strip accents + trim + collapse whitespace.
 * Use on onChange or onBlur to ensure stored value is clean.
 */
export function normalizeProductNameInput(name: string): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");
}
