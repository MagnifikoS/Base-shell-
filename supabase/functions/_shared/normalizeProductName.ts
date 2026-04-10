 /**
  * SSOT: Product Name Normalization for Edge Functions
  * 
  * CRITICAL: This MUST match src/modules/produits/utils/normalizeProductName.ts
  * Single source of truth for product name deduplication.
  * 
  * Rules:
  * - Lowercase
  * - Remove accents (NFD decomposition)
  * - Collapse whitespace
  * - Trim
  */
 
 export function normalizeProductName(name: string): string {
   if (!name || typeof name !== 'string') {
     return '';
   }
 
   return name
     // Lowercase
     .toLowerCase()
     // Remove accents (NFD decomposition + strip combining marks)
     .normalize('NFD')
     .replace(/[\u0300-\u036f]/g, '')
     // Replace multiple spaces/tabs/newlines with single space
     .replace(/\s+/g, ' ')
     // Trim
     .trim();
 }