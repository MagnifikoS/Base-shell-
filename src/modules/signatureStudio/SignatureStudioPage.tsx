import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { usePdfDocument } from "./hooks/usePdfDocument";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useDocumentsStorage } from "./hooks/useDocumentsStorage";
import { DocumentsList } from "./components/DocumentsList";
import { Toolbar } from "./components/Toolbar";
import { FieldPalette } from "./components/FieldPalette";
import { PdfSinglePageViewer } from "./components/PdfSinglePageViewer";
import { OverlayLayer } from "./components/OverlayLayer";
import { SignaturePadModal } from "./components/SignaturePadModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import type { StampAsset, Field, SavedDocument } from "./utils/types";
import { getDefaultPositionForKind } from "./utils/defaults";

type ViewMode = "list" | "editor";

export function SignatureStudioPage() {
  const _navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);

  const { loadDocuments, saveDocument, deleteDocument, getDocument } = useDocumentsStorage();
  const [documents, setDocuments] = useState<SavedDocument[]>([]);

  const {
    document,
    isLoading,
    error,
    currentPageCanvas,
    loadPdf,
    loadPdfFromDataUrl,
    goToPage,
    setZoom,
    closePdf,
  } = usePdfDocument();

  // Assets state
  const [assets, setAssets] = useState<StampAsset[]>([]);

  // Fields with undo/redo
  const {
    state: fields,
    set: setFields,
    undo,
    redo,
    reset: resetFields,
    canUndo,
    canRedo,
  } = useUndoRedo<Field[]>([]);

  // UI state
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureModalType, setSignatureModalType] = useState<"paraphe" | "signature">("paraphe");
  const _fileInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);

  // Load documents on mount
  useEffect(() => {
    setDocuments(loadDocuments());
  }, [loadDocuments]);

  // Open new document flow
  const handleNewDocument = useCallback(() => {
    setEditingDocId(null);
    setAssets([]);
    resetFields([]);
    setPdfDataUrl(null);
    closePdf();
    setViewMode("editor");
  }, [closePdf, resetFields]);

  // Open existing document
  const handleOpenDocument = useCallback(
    (id: string) => {
      const doc = getDocument(id);
      if (!doc) return;

      setEditingDocId(id);
      setAssets(doc.assets);
      resetFields(doc.fields);
      setPdfDataUrl(doc.pdfDataUrl);
      loadPdfFromDataUrl(doc.pdfDataUrl, doc.fileName);
      setViewMode("editor");
    },
    [getDocument, resetFields, loadPdfFromDataUrl]
  );

  // Delete document
  const handleDeleteDocument = useCallback(
    (id: string) => {
      deleteDocument(id);
      setDocuments(loadDocuments());
      toast.success("Document supprimé");
    },
    [deleteDocument, loadDocuments]
  );

  // Back to list
  const handleBackToList = useCallback(() => {
    closePdf();
    setAssets([]);
    resetFields([]);
    setPdfDataUrl(null);
    setEditingDocId(null);
    setViewMode("list");
    setDocuments(loadDocuments());
  }, [closePdf, resetFields, loadDocuments]);

  // Handle PDF import
  const handleImportPdf = useCallback(
    async (file: File) => {
      // Convert to data URL for storage
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        setPdfDataUrl(dataUrl);
        await loadPdf(file);
      };
      reader.readAsDataURL(file);
    },
    [loadPdf]
  );

  // Navigation
  const handlePrevPage = useCallback(() => {
    if (document && document.currentPageIndex > 0) {
      goToPage(document.currentPageIndex - 1);
    }
  }, [document, goToPage]);

  const handleNextPage = useCallback(() => {
    if (document && document.currentPageIndex < document.numPages - 1) {
      goToPage(document.currentPageIndex + 1);
    }
  }, [document, goToPage]);

  // Zoom
  const handleZoomIn = useCallback(() => {
    if (document && document.zoom < 2) {
      setZoom(Math.min(2, document.zoom + 0.25));
    }
  }, [document, setZoom]);

  const handleZoomOut = useCallback(() => {
    if (document && document.zoom > 0.5) {
      setZoom(Math.max(0.5, document.zoom - 0.25));
    }
  }, [document, setZoom]);

  // Create paraphe/signature
  const handleOpenSignatureModal = useCallback((type: "paraphe" | "signature") => {
    setSignatureModalType(type);
    setSignatureModalOpen(true);
  }, []);

  const handleSaveSignature = useCallback(
    (pngDataUrl: string) => {
      const newAsset: StampAsset = {
        id: `${signatureModalType}-${Date.now()}`,
        type: signatureModalType,
        pngDataUrl,
        label: signatureModalType === "paraphe" ? "Mon paraphe" : "Ma signature",
      };
      setAssets((prev) => [...prev, newAsset]);
    },
    [signatureModalType]
  );

  // Upload stamp
  const handleUploadStamp = useCallback(() => {
    stampInputRef.current?.click();
  }, []);

  const handleStampFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const newAsset: StampAsset = {
        id: `stamp-${Date.now()}`,
        type: "stamp",
        pngDataUrl: dataUrl,
        label: "Mon tampon",
      };
      setAssets((prev) => [...prev, newAsset]);
    };
    reader.readAsDataURL(file);

    if (stampInputRef.current) {
      stampInputRef.current.value = "";
    }
  }, []);

  // Add field to current page
  const handleAddField = useCallback(
    (kind: Field["kind"]) => {
      if (!document) return;

      const assetOfKind = assets.find((a) => a.type === kind);
      if (!assetOfKind) return;

      const defaults = getDefaultPositionForKind(kind);
      const newField: Field = {
        id: `${kind}-${Date.now()}`,
        pageIndex: document.currentPageIndex,
        kind,
        ...defaults,
        assetId: assetOfKind.id,
        label: `${kind} p.${document.currentPageIndex + 1}`,
      };

      setFields((prev) => [...prev, newField]);
      setSelectedFieldId(newField.id);
    },
    [document, assets, setFields]
  );

  // Update field
  const handleUpdateField = useCallback(
    (id: string, updates: Partial<Field>) => {
      setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
    },
    [setFields]
  );

  // Delete field
  const handleDeleteField = useCallback(
    (id: string) => {
      setFields((prev) => prev.filter((f) => f.id !== id));
      if (selectedFieldId === id) {
        setSelectedFieldId(null);
      }
    },
    [setFields, selectedFieldId]
  );

  // Delete asset (and its fields)
  const handleDeleteAsset = useCallback(
    (id: string) => {
      setAssets((prev) => prev.filter((a) => a.id !== id));
      setFields((prev) => prev.filter((f) => f.assetId !== id));
    },
    [setFields]
  );

  // Reset all positions
  const handleResetPositions = useCallback(() => {
    if (!document) return;

    setFields((prev) =>
      prev.map((f) => ({
        ...f,
        ...getDefaultPositionForKind(f.kind),
      }))
    );
  }, [document, setFields]);

  // Deselect on click outside
  const handleBackgroundClick = useCallback(() => {
    setSelectedFieldId(null);
  }, []);

  // Validate and save
  const handleValidate = useCallback(() => {
    if (!document || !pdfDataUrl) {
      toast.error("Aucun document à valider");
      return;
    }

    if (fields.length === 0) {
      toast.error("Ajoutez au moins un champ avant de valider");
      return;
    }

    const saved = saveDocument({
      id: editingDocId || undefined,
      fileName: document.fileName,
      numPages: document.numPages,
      pdfDataUrl,
      assets,
      fields,
    });

    toast.success(`Document "${saved.fileName}" sauvegardé avec ${fields.length} champ(s)`);
    handleBackToList();
  }, [document, pdfDataUrl, fields, assets, editingDocId, saveDocument, handleBackToList]);

  const pageWidth = document ? document.pageSizePx.width * document.zoom : 0;
  const pageHeight = document ? document.pageSizePx.height * document.zoom : 0;

  // List view
  if (viewMode === "list") {
    return (
      <ResponsiveLayout>
        <div className="max-w-6xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">Studio Signature</h1>
            <p className="text-muted-foreground">
              Placement de paraphes, signatures et tampons sur vos documents PDF
            </p>
          </div>
          <DocumentsList
            documents={documents}
            onNewDocument={handleNewDocument}
            onOpenDocument={handleOpenDocument}
            onDeleteDocument={handleDeleteDocument}
          />
        </div>
      </ResponsiveLayout>
    );
  }

  // Editor view
  return (
    <ResponsiveLayout>
      <div className="flex flex-col h-[calc(100vh-5rem)] -m-6">
        {/* Header with back button */}
        <div className="border-b bg-background px-4 py-3 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={handleBackToList}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-lg font-semibold">
              {editingDocId ? "Modifier le document" : "Nouveau document"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {document?.fileName || "Importez un PDF pour commencer"}
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <Toolbar
          document={document}
          isLoading={isLoading}
          canUndo={canUndo}
          canRedo={canRedo}
          hasFields={fields.length > 0}
          onImportPdf={handleImportPdf}
          onPrevPage={handlePrevPage}
          onNextPage={handleNextPage}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetPositions={handleResetPositions}
          onUndo={undo}
          onRedo={redo}
          onValidate={handleValidate}
        />

        {/* Main content */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left panel - Palette */}
          <div className="w-64 border-r bg-background p-4 overflow-y-auto">
            <FieldPalette
              assets={assets}
              fields={fields}
              currentPageIndex={document?.currentPageIndex ?? 0}
              selectedFieldId={selectedFieldId}
              onCreateParaphe={() => handleOpenSignatureModal("paraphe")}
              onCreateSignature={() => handleOpenSignatureModal("signature")}
              onUploadStamp={handleUploadStamp}
              onAddField={handleAddField}
              onSelectField={setSelectedFieldId}
              onDeleteAsset={handleDeleteAsset}
            />
          </div>

          {/* Right panel - PDF Viewer */}
          <div className="flex-1 p-4 overflow-auto bg-muted/30" onClick={handleBackgroundClick}>
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <Card className="max-w-md mx-auto mt-8">
                <CardContent className="pt-6 flex flex-col items-center gap-2 text-destructive">
                  <AlertCircle className="h-8 w-8" />
                  <p>{error}</p>
                </CardContent>
              </Card>
            ) : !document ? (
              <Card className="max-w-md mx-auto mt-8">
                <CardContent className="pt-6 flex flex-col items-center gap-4 text-center">
                  <p className="text-muted-foreground">Cliquez sur "Importer PDF" pour commencer</p>
                </CardContent>
              </Card>
            ) : (
              <div onClick={(e) => e.stopPropagation()}>
                <PdfSinglePageViewer canvas={currentPageCanvas} zoom={document?.zoom ?? 1}>
                  {document && (
                    <OverlayLayer
                      fields={fields}
                      assets={assets}
                      pageIndex={document.currentPageIndex}
                      pageWidthPx={pageWidth}
                      pageHeightPx={pageHeight}
                      selectedFieldId={selectedFieldId}
                      onSelectField={setSelectedFieldId}
                      onUpdateField={handleUpdateField}
                      onDeleteField={handleDeleteField}
                    />
                  )}
                </PdfSinglePageViewer>
              </div>
            )}
          </div>
        </div>

        {/* Signature/Paraphe Modal */}
        <SignaturePadModal
          open={signatureModalOpen}
          onClose={() => setSignatureModalOpen(false)}
          onSave={handleSaveSignature}
          title={signatureModalType === "paraphe" ? "Créer un paraphe" : "Créer une signature"}
          type={signatureModalType}
        />

        {/* Hidden file input for stamp upload */}
        <input
          ref={stampInputRef}
          type="file"
          accept="image/*"
          onChange={handleStampFileChange}
          className="hidden"
        />
      </div>
    </ResponsiveLayout>
  );
}
