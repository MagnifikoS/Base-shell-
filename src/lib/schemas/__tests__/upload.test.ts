import { describe, it, expect } from "vitest";
import {
  validateFileUpload,
  MAX_FILE_SIZE,
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_INVOICE_TYPES,
} from "../upload";

// Helper to create a mock File
function createMockFile(name: string, size: number, type: string): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

describe("validateFileUpload", () => {
  it("should accept a valid PDF file", () => {
    const file = createMockFile("doc.pdf", 1024 * 1024, "application/pdf");
    const result = validateFileUpload(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should accept a valid JPEG image", () => {
    const file = createMockFile("photo.jpg", 2 * 1024 * 1024, "image/jpeg");
    const result = validateFileUpload(file);
    expect(result.valid).toBe(true);
  });

  it("should accept a valid PNG image", () => {
    const file = createMockFile("photo.png", 500 * 1024, "image/png");
    const result = validateFileUpload(file);
    expect(result.valid).toBe(true);
  });

  it("should reject a file that exceeds max size", () => {
    const file = createMockFile("big.pdf", 15 * 1024 * 1024, "application/pdf");
    const result = validateFileUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("10 Mo");
  });

  it("should reject a file with non-allowed type", () => {
    const file = createMockFile("script.js", 1024, "application/javascript");
    const result = validateFileUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Type de fichier non autorisé");
  });

  it("should reject an executable", () => {
    const file = createMockFile("malware.exe", 1024, "application/x-msdownload");
    const result = validateFileUpload(file);
    expect(result.valid).toBe(false);
  });

  it("should accept custom max size option", () => {
    const smallMax = 1024; // 1KB
    const file = createMockFile("doc.pdf", 2048, "application/pdf");
    const result = validateFileUpload(file, { maxSize: smallMax });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("0 Mo");
  });

  it("should accept custom allowed types option", () => {
    const file = createMockFile("doc.pdf", 1024, "application/pdf");
    const result = validateFileUpload(file, { allowedTypes: ["image/jpeg"] });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("jpeg");
  });

  it("should accept HEIC with invoice types", () => {
    const file = createMockFile("photo.heic", 1024 * 1024, "image/heic");
    const result = validateFileUpload(file, { allowedTypes: ALLOWED_INVOICE_TYPES });
    expect(result.valid).toBe(true);
  });

  it("should export constants", () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
    expect(ALLOWED_DOCUMENT_TYPES).toContain("application/pdf");
    expect(ALLOWED_DOCUMENT_TYPES).toContain("image/jpeg");
    expect(ALLOWED_INVOICE_TYPES).toContain("image/heic");
  });
});
