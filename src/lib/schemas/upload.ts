const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILENAME_LENGTH = 200;

const ALLOWED_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const ALLOWED_INVOICE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];

/**
 * SSOT upload limits — unified constants for all upload scenarios.
 * Vision AI has a stricter limit (6 MB) due to AI provider payload constraints.
 */
export const UPLOAD_LIMITS = {
  MAX_FILE_SIZE_MB: 10,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  VISION_AI_MAX_MB: 6,
  VISION_AI_MAX_BYTES: 6 * 1024 * 1024,
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp"] as const,
  ALLOWED_DOC_TYPES: ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const,
  MAX_FILENAME_LENGTH: 200,
} as const;

/**
 * Sanitize a filename: strip path separators, normalize Unicode, truncate.
 * Returns the cleaned filename (safe for storage).
 */
export function sanitizeFilename(name: string): string {
  // Strip path separators and null bytes
  let clean = name.replace(/[/\\:\0]/g, "_");
  // Collapse multiple underscores/spaces
  clean = clean.replace(/[_\s]+/g, "_").trim();
  // Truncate to MAX_FILENAME_LENGTH (preserve extension)
  if (clean.length > MAX_FILENAME_LENGTH) {
    const ext = clean.lastIndexOf(".");
    if (ext > 0) {
      const extension = clean.slice(ext);
      clean = clean.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
    } else {
      clean = clean.slice(0, MAX_FILENAME_LENGTH);
    }
  }
  return clean;
}

export function validateFileUpload(
  file: File,
  options?: { maxSize?: number; allowedTypes?: string[] }
): { valid: boolean; error?: string } {
  const maxSize = options?.maxSize ?? MAX_FILE_SIZE;
  const allowedTypes = options?.allowedTypes ?? ALLOWED_DOCUMENT_TYPES;

  // HARDENING: Validate filename length and characters
  if (file.name.length > MAX_FILENAME_LENGTH) {
    return {
      valid: false,
      error: `Le nom du fichier est trop long (max ${MAX_FILENAME_LENGTH} caractères)`,
    };
  }

  if (file.size > maxSize) {
    const maxMB = Math.round(maxSize / 1024 / 1024);
    return { valid: false, error: `Le fichier dépasse la taille maximale de ${maxMB} Mo` };
  }

  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Type de fichier non autorisé. Types acceptés : ${allowedTypes.map((t) => t.split("/")[1]).join(", ")}`,
    };
  }

  return { valid: true };
}

export { MAX_FILE_SIZE, MAX_FILENAME_LENGTH, ALLOWED_DOCUMENT_TYPES, ALLOWED_INVOICE_TYPES };
