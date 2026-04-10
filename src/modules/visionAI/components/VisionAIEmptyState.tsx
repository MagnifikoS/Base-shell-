/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — EMPTY STATE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Design épuré et moderne pour l'état initial de Vision AI.
 * Style minimaliste "AI-inspired" avec zone de drop centrale.
 * Supports both click-to-upload and drag-and-drop.
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Settings, Upload, Sparkles, FileText, Zap, Shield } from "lucide-react";

interface VisionAIEmptyStateProps {
  isLoading: boolean;
  onImport: () => void;
  onSettingsOpen: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFileDrop?: (files: FileList) => void;
}

export function VisionAIEmptyState({
  isLoading,
  onImport,
  onSettingsOpen,
  fileInputRef,
  onFileChange,
  onFileDrop,
}: VisionAIEmptyStateProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isLoading) setIsDragOver(true);
    },
    [isLoading]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isLoading) setIsDragOver(true);
    },
    [isLoading]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only reset when leaving the dropzone itself (not child elements)
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (isLoading) return;

      const files = e.dataTransfer.files;
      if (files.length > 0 && onFileDrop) {
        onFileDrop(files);
      }
    },
    [isLoading, onFileDrop]
  );

  return (
    <div
      className="min-h-[70vh] flex flex-col items-center justify-center"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header — centered */}
      <div className="flex items-center justify-between w-full max-w-lg mb-8">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Vision AI</h1>
            <p className="text-sm text-muted-foreground">
              Extraction intelligente de vos documents
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSettingsOpen}
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings className="h-4 w-4 mr-2" />
          Paramètres
        </Button>
      </div>

      {/* Central Drop Zone */}
      <div className="w-full max-w-lg">
        {/* Drop Zone Card */}
        <div
          onClick={isLoading ? undefined : onImport}
          className={`
            relative overflow-hidden rounded-2xl border-2 border-dashed
            transition-all duration-300 cursor-pointer group
            ${
              isDragOver
                ? "border-primary bg-primary/10 scale-[1.02] shadow-lg shadow-primary/10"
                : isLoading
                  ? "border-primary/40 bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/30"
            }
          `}
        >
          {/* Gradient Background Effect */}
          <div
            className={`absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 transition-opacity duration-500 ${isDragOver ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          />

          <div className="relative p-12 flex flex-col items-center text-center pointer-events-none">
            {/* Icon Container */}
            <div
              className={`
              relative mb-6 h-20 w-20 rounded-2xl
              bg-gradient-to-br from-primary/10 to-primary/5
              flex items-center justify-center
              transition-transform duration-300
              ${isDragOver ? "scale-110" : "group-hover:scale-105"}
              ${isLoading ? "animate-pulse" : ""}
            `}
            >
              <Upload
                className={`h-8 w-8 text-primary transition-transform duration-300 ${isDragOver ? "-translate-y-1" : isLoading ? "" : "group-hover:-translate-y-0.5"}`}
              />

              {/* Decorative dots */}
              <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-primary/20" />
              <div className="absolute -bottom-1 -left-1 h-2 w-2 rounded-full bg-primary/30" />
            </div>

            {/* Text */}
            <h2 className="text-lg font-medium mb-2">
              {isDragOver
                ? "Deposez le fichier ici"
                : isLoading
                  ? "Scan en cours..."
                  : "Importer un document"}
            </h2>
            <p className="text-sm text-muted-foreground max-w-xs mb-6">
              {isDragOver
                ? "Relachez pour lancer le scan"
                : isLoading
                  ? "Analyse de votre document en cours..."
                  : "Glissez-deposez un PDF ou une image, ou cliquez pour selectionner"}
            </p>

            {/* CTA Button */}
            {!isDragOver && (
              <Button
                size="lg"
                disabled={isLoading}
                className="px-8 shadow-lg shadow-primary/20 pointer-events-auto"
              >
                <FileText className="h-4 w-4 mr-2" />
                {isLoading ? "Scan en cours..." : "Choisir un fichier"}
              </Button>
            )}
          </div>
        </div>

        {/* Features Grid */}
        <div className="mt-8 grid grid-cols-3 gap-4">
          <FeatureCard icon={Sparkles} title="IA avancee" description="Extraction automatique" />
          <FeatureCard icon={Zap} title="Rapide" description="Traitement instantane" />
          <FeatureCard icon={Shield} title="Securise" description="Donnees protegees" />
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf,.jpg,.jpeg,.png,.webp,.tiff,.tif,image/jpeg,image/png,image/webp,image/tiff"
        onChange={onFileChange}
        className="hidden"
        disabled={isLoading}
      />
    </div>
  );
}

interface FeatureCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
}

function FeatureCard({ icon: Icon, title, description }: FeatureCardProps) {
  return (
    <div className="flex flex-col items-center text-center p-4 rounded-xl bg-muted/30 border border-border/50">
      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="text-xs font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
