/**
 * Default values for auto-placement heuristics
 * All values in normalized coordinates (0..1)
 */

import type { Field } from './types';

// Default sizes
export const DEFAULT_PARAPHE = {
  wPct: 0.10,
  hPct: 0.06,
  xPct: 0.85,
  yPct: 0.90,
};

export const DEFAULT_SIGNATURE = {
  wPct: 0.25,
  hPct: 0.10,
  xPct: 0.70,
  yPct: 0.82,
};

export const DEFAULT_STAMP = {
  wPct: 0.18,
  hPct: 0.18,
  xPct: 0.50,
  yPct: 0.78,
};

/**
 * Generate initial fields when a PDF is loaded
 * - Paraphe on every page (bottom-right)
 * - Signature on last page (bottom-right)
 * - Stamp on last page (center-bottom)
 */
export function generateInitialFields(
  numPages: number,
  parapheAssetId: string,
  signatureAssetId: string,
  stampAssetId?: string
): Field[] {
  const fields: Field[] = [];
  
  // Paraphe on every page
  for (let i = 0; i < numPages; i++) {
    fields.push({
      id: `paraphe-page-${i}-${Date.now()}`,
      pageIndex: i,
      kind: 'paraphe',
      ...DEFAULT_PARAPHE,
      assetId: parapheAssetId,
      label: `Paraphe p.${i + 1}`,
    });
  }
  
  // Signature on last page only
  fields.push({
    id: `signature-last-${Date.now()}`,
    pageIndex: numPages - 1,
    kind: 'signature',
    ...DEFAULT_SIGNATURE,
    assetId: signatureAssetId,
    label: 'Signature',
  });
  
  // Stamp on last page if provided
  if (stampAssetId) {
    fields.push({
      id: `stamp-last-${Date.now()}`,
      pageIndex: numPages - 1,
      kind: 'stamp',
      ...DEFAULT_STAMP,
      assetId: stampAssetId,
      label: 'Tampon',
    });
  }
  
  return fields;
}

export function getDefaultPositionForKind(kind: Field['kind']) {
  switch (kind) {
    case 'paraphe':
      return DEFAULT_PARAPHE;
    case 'signature':
      return DEFAULT_SIGNATURE;
    case 'stamp':
      return DEFAULT_STAMP;
  }
}
