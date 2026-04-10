/**
 * Types for Signature Studio - 100% isolated, no DB
 */

export interface DocumentState {
  fileName: string;
  numPages: number;
  currentPageIndex: number;
  pageSizePx: { width: number; height: number };
  zoom: number;
}

export interface StampAsset {
  id: string;
  type: 'paraphe' | 'signature' | 'stamp';
  pngDataUrl: string;
  label?: string;
}

export interface Field {
  id: string;
  pageIndex: number;
  kind: 'paraphe' | 'signature' | 'stamp';
  /** Position X en % (0..1) */
  xPct: number;
  /** Position Y en % (0..1) */
  yPct: number;
  /** Largeur en % (0..1) */
  wPct: number;
  /** Hauteur en % (0..1) */
  hPct: number;
  assetId: string;
  label?: string;
}

export interface StudioState {
  document: DocumentState | null;
  assets: StampAsset[];
  fields: Field[];
}

export interface SavedDocument {
  id: string;
  fileName: string;
  numPages: number;
  fieldsCount: number;
  assets: StampAsset[];
  fields: Field[];
  pdfDataUrl: string; // Base64 encoded PDF
  createdAt: string;
  updatedAt: string;
}

export const INITIAL_STUDIO_STATE: StudioState = {
  document: null,
  assets: [],
  fields: [],
};
