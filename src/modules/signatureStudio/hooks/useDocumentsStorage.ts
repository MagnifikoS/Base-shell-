import { useCallback } from "react";
import type { SavedDocument, StampAsset, Field } from "../utils/types";

const DOCUMENTS_STORAGE_KEY = "signature-studio-documents";

export function useDocumentsStorage() {
  const loadDocuments = useCallback((): SavedDocument[] => {
    try {
      const stored = localStorage.getItem(DOCUMENTS_STORAGE_KEY);
      if (!stored) return [];
      return JSON.parse(stored) as SavedDocument[];
    } catch (err) {
      if (import.meta.env.DEV) console.warn("Failed to load documents from localStorage:", err);
      return [];
    }
  }, []);

  const saveDocument = useCallback(
    (doc: {
      id?: string;
      fileName: string;
      numPages: number;
      pdfDataUrl: string;
      assets: StampAsset[];
      fields: Field[];
    }): SavedDocument => {
      const documents = loadDocuments();
      const now = new Date().toISOString();

      const existingIndex = doc.id ? documents.findIndex((d) => d.id === doc.id) : -1;

      const savedDoc: SavedDocument = {
        id: doc.id || `doc-${Date.now()}`,
        fileName: doc.fileName,
        numPages: doc.numPages,
        fieldsCount: doc.fields.length,
        assets: doc.assets,
        fields: doc.fields,
        pdfDataUrl: doc.pdfDataUrl,
        createdAt: existingIndex >= 0 ? documents[existingIndex].createdAt : now,
        updatedAt: now,
      };

      if (existingIndex >= 0) {
        documents[existingIndex] = savedDoc;
      } else {
        documents.unshift(savedDoc);
      }

      try {
        localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(documents));
      } catch (err) {
        if (import.meta.env.DEV) console.warn("Failed to save document to localStorage:", err);
      }

      return savedDoc;
    },
    [loadDocuments]
  );

  const deleteDocument = useCallback(
    (id: string) => {
      const documents = loadDocuments();
      const filtered = documents.filter((d) => d.id !== id);
      try {
        localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(filtered));
      } catch (err) {
        if (import.meta.env.DEV) console.warn("Failed to delete document from localStorage:", err);
      }
    },
    [loadDocuments]
  );

  const getDocument = useCallback(
    (id: string): SavedDocument | null => {
      const documents = loadDocuments();
      return documents.find((d) => d.id === id) || null;
    },
    [loadDocuments]
  );

  return {
    loadDocuments,
    saveDocument,
    deleteDocument,
    getDocument,
  };
}
