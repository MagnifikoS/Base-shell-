import { useState, useCallback, useRef, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { DocumentState } from "../utils/types";

// Configure PDF.js worker using the local package
// Using a direct import URL to avoid CDN CORS issues
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PageCache {
  [pageIndex: number]: HTMLCanvasElement;
}

export function usePdfDocument() {
  const [document, setDocument] = useState<DocumentState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPageCanvas, setCurrentPageCanvas] = useState<HTMLCanvasElement | null>(null);

  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pageCacheRef = useRef<PageCache>({});

  const loadPdf = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    pageCacheRef.current = {};

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      pdfDocRef.current = pdfDoc;

      const firstPage = await pdfDoc.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1.0 });

      setDocument({
        fileName: file.name,
        numPages: pdfDoc.numPages,
        currentPageIndex: 0,
        pageSizePx: { width: viewport.width, height: viewport.height },
        zoom: 1.0,
      });

      // Render first page
      await renderPage(0, 1.0);
    } catch (err) {
      if (import.meta.env.DEV) console.error("PDF load error:", err);
      setError("Erreur lors du chargement du PDF");
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPdfFromDataUrl = useCallback(async (dataUrl: string, fileName: string) => {
    setIsLoading(true);
    setError(null);
    pageCacheRef.current = {};

    try {
      // Convert base64 data URL to ArrayBuffer
      const base64 = dataUrl.split(",")[1];
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
      pdfDocRef.current = pdfDoc;

      const firstPage = await pdfDoc.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1.0 });

      setDocument({
        fileName,
        numPages: pdfDoc.numPages,
        currentPageIndex: 0,
        pageSizePx: { width: viewport.width, height: viewport.height },
        zoom: 1.0,
      });

      // Render first page
      await renderPage(0, 1.0);
    } catch (err) {
      if (import.meta.env.DEV) console.error("PDF load from dataUrl error:", err);
      setError("Erreur lors du chargement du PDF");
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderPage = useCallback(async (pageIndex: number, zoom: number) => {
    if (!pdfDocRef.current) return;

    // Check cache first
    const cacheKey = pageIndex;
    if (pageCacheRef.current[cacheKey]) {
      setCurrentPageCanvas(pageCacheRef.current[cacheKey]);
      return;
    }

    try {
      const page = await pdfDocRef.current.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: zoom });

      const canvas = window.document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context not available");

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      pageCacheRef.current[cacheKey] = canvas;
      setCurrentPageCanvas(canvas);

      // Update page size in document state
      setDocument((prev) =>
        prev
          ? {
              ...prev,
              pageSizePx: { width: viewport.width, height: viewport.height },
            }
          : null
      );
    } catch (err) {
      if (import.meta.env.DEV) console.error("Page render error:", err);
      setError("Erreur lors du rendu de la page");
    }
  }, []);

  const goToPage = useCallback(
    async (pageIndex: number) => {
      if (!document || pageIndex < 0 || pageIndex >= document.numPages) return;

      setDocument((prev) => (prev ? { ...prev, currentPageIndex: pageIndex } : null));
      await renderPage(pageIndex, document.zoom);
    },
    [document, renderPage]
  );

  const setZoom = useCallback(
    async (newZoom: number) => {
      if (!document) return;

      // Clear cache when zoom changes
      pageCacheRef.current = {};

      setDocument((prev) => (prev ? { ...prev, zoom: newZoom } : null));
      await renderPage(document.currentPageIndex, newZoom);
    },
    [document, renderPage]
  );

  const closePdf = useCallback(() => {
    pdfDocRef.current?.destroy();
    pdfDocRef.current = null;
    pageCacheRef.current = {};
    setDocument(null);
    setCurrentPageCanvas(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pdfDocRef.current?.destroy();
    };
  }, []);

  return {
    document,
    isLoading,
    error,
    currentPageCanvas,
    loadPdf,
    loadPdfFromDataUrl,
    goToPage,
    setZoom,
    closePdf,
  };
}
