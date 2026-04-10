// Types for employee documents module
export interface EmployeeDocument {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  document_type: DocumentType;
  created_at: string;
}

export type DocumentType =
  | "piece_identite_fr"
  | "piece_identite_eu"
  | "passeport_fr"
  | "passeport_eu"
  | "passeport_etranger"
  | "recepisse";

export const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: "piece_identite_fr", label: "Pièce d'identité française" },
  { value: "piece_identite_eu", label: "Pièce d'identité européenne" },
  { value: "passeport_fr", label: "Passeport français" },
  { value: "passeport_eu", label: "Passeport européen" },
  { value: "passeport_etranger", label: "Passeport étranger" },
  { value: "recepisse", label: "Récépissé" },
];

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function getDocumentTypeLabel(type: DocumentType): string {
  return DOCUMENT_TYPES.find((t) => t.value === type)?.label || type;
}
