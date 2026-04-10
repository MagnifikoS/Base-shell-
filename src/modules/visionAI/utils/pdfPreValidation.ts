import * as pdfjsLib from "pdfjs-dist";

// Reuse existing worker config
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_PAGES = 20;

const ACCEPTED_PDF_TYPES = ["application/pdf"];
const ACCEPTED_PDF_EXTENSIONS = [".pdf"];

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/tiff"];
const ACCEPTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif"];

const ACCEPTED_TYPES = [...ACCEPTED_PDF_TYPES, ...ACCEPTED_IMAGE_TYPES];
const ACCEPTED_EXTENSIONS = [...ACCEPTED_PDF_EXTENSIONS, ...ACCEPTED_IMAGE_EXTENSIONS];

export type PdfValidationError = {
  title: string;
  description: string;
};

/** Check if a file is an image (not a PDF) */
export function isImageFile(file: File): boolean {
  const extension = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
  return ACCEPTED_IMAGE_TYPES.includes(file.type) || ACCEPTED_IMAGE_EXTENSIONS.includes(extension);
}

/**
 * Pre-validate a file (PDF or image) BEFORE sending to the edge function.
 * Returns null if valid, or an error object with a clear user-facing message.
 */
export async function validatePdfBeforeExtraction(file: File): Promise<PdfValidationError | null> {
  // 1. Format check
  const extension = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
  const isAcceptedType = ACCEPTED_TYPES.includes(file.type);
  const isAcceptedExt = ACCEPTED_EXTENSIONS.includes(extension);

  if (!isAcceptedType && !isAcceptedExt) {
    return {
      title: "Format non supporté",
      description: `Le fichier "${file.name}" est au format ${extension || file.type || "inconnu"}. Formats acceptés : PDF, JPG, PNG, WebP, TIFF.`,
    };
  }

  // 2. File size check
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      title: "Fichier trop volumineux",
      description: `Le fichier pèse ${sizeMB} Mo. La limite est de ${MAX_FILE_SIZE_MB} Mo. Essayez de réduire la qualité du scan ou de compresser le fichier avant de le ré-importer.`,
    };
  }

  // 3. For images, skip page count check — validation done
  if (isImageFile(file)) {
    return null;
  }

  // 4. Page count check for PDFs (requires parsing the PDF header)
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = pdfDoc.numPages;

    if (pageCount > MAX_PAGES) {
      return {
        title: "PDF trop long",
        description: `Ce PDF contient ${pageCount} pages. La limite est de ${MAX_PAGES} pages. Au-delà, veuillez découper le PDF avant de le ré-importer.`,
      };
    }
  } catch {
    return {
      title: "PDF illisible",
      description: `Le fichier "${file.name}" n'a pas pu être lu. Il est peut-être corrompu, protégé par mot de passe, ou dans un format PDF non standard. Essayez de le ré-exporter depuis votre logiciel de facturation.`,
    };
  }

  return null;
}
