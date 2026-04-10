import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  FileUp,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Undo2,
  Redo2,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import type { DocumentState } from "../utils/types";
import { validateFileUpload } from "@/lib/schemas/upload";

interface ToolbarProps {
  document: DocumentState | null;
  isLoading: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasFields: boolean;
  onImportPdf: (file: File) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetPositions: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onValidate: () => void;
}

export function Toolbar({
  document,
  isLoading,
  canUndo,
  canRedo,
  hasFields,
  onImportPdf,
  onPrevPage,
  onNextPage,
  onZoomIn,
  onZoomOut,
  onResetPositions,
  onUndo,
  onRedo,
  onValidate,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file before import (PDF-only for signature studio)
      const validation = validateFileUpload(file, {
        allowedTypes: ["application/pdf"],
      });
      if (!validation.valid) {
        toast.error(validation.error);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return;
      }
      onImportPdf(file);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2 p-3 border-b bg-background">
      {/* Import PDF */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        className="hidden"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
      >
        <FileUp className="h-4 w-4 mr-2" />
        Importer PDF
      </Button>

      {document && (
        <>
          <Separator orientation="vertical" className="h-6" />

          {/* Page navigation */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onPrevPage}
              disabled={document.currentPageIndex === 0}
              aria-label="Page précédente"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm min-w-[80px] text-center">
              {document.currentPageIndex + 1} / {document.numPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onNextPage}
              disabled={document.currentPageIndex >= document.numPages - 1}
              aria-label="Page suivante"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onZoomOut} aria-label="Dézoomer">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm min-w-[50px] text-center">
              {Math.round(document.zoom * 100)}%
            </span>
            <Button variant="ghost" size="icon" onClick={onZoomIn} aria-label="Zoomer">
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Undo/Redo */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onUndo}
              disabled={!canUndo}
              title="Annuler"
              aria-label="Annuler"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRedo}
              disabled={!canRedo}
              title="Rétablir"
              aria-label="Rétablir"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Reset positions */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onResetPositions}
            title="Réinitialiser les positions"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>

          <Separator orientation="vertical" className="h-6" />

          {/* Validate */}
          <Button
            variant="default"
            size="sm"
            onClick={onValidate}
            disabled={!hasFields}
            title="Valider et prévisualiser"
          >
            <Eye className="h-4 w-4 mr-2" />
            Valider
          </Button>
        </>
      )}

      {/* File name */}
      {document && (
        <div className="ml-auto text-sm text-muted-foreground truncate max-w-[200px]">
          {document.fileName}
        </div>
      )}
    </div>
  );
}
