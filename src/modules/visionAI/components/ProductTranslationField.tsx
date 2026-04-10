import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Globe } from "lucide-react";
import { useProductTranslation } from "../hooks/useProductTranslation";

interface ProductTranslationFieldProps {
  /** Original product name - SOURCE OF TRUTH, never modified */
  originalName: string;
  /** Callback when translation is loaded or user edits */
  onTranslationChange?: (value: string) => void;
}

/**
 * Translation field shown ONLY for non-French products
 * 
 * RULES:
 * - Triggered AFTER extraction (UI enrichment only)
 * - Original name is NEVER modified
 * - Translation is informational and editable
 * - Does NOT block any workflow
 * - NOW: Calls onTranslationChange when translation is fetched
 */
export function ProductTranslationField({ 
  originalName, 
  onTranslationChange 
}: ProductTranslationFieldProps) {
  const {
    isLoading,
    detectedLang,
    editedTranslation,
    setEditedTranslation,
    shouldShowTranslation,
  } = useProductTranslation(originalName);

  // Notify parent when translation is loaded automatically
  useEffect(() => {
    if (editedTranslation && onTranslationChange) {
      onTranslationChange(editedTranslation);
    }
  }, [editedTranslation, onTranslationChange]);

  // Don't render anything for French products
  if (!shouldShowTranslation && !isLoading) {
    return null;
  }

  const handleChange = (value: string) => {
    setEditedTranslation(value);
    onTranslationChange?.(value);
  };

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2 text-muted-foreground">
        <Globe className="h-3.5 w-3.5" />
        <span>Nom produit (FR)</span>
        {detectedLang && detectedLang !== "fr" && (
          <span className="text-xs bg-muted px-1.5 py-0.5 rounded uppercase">
            {detectedLang}
          </span>
        )}
      </Label>
      
      {isLoading ? (
        <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/30">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Traduction en cours...</span>
        </div>
      ) : (
        <Input
          value={editedTranslation ?? ""}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Traduction française"
          className="bg-muted/30"
        />
      )}
      
      <p className="text-xs text-muted-foreground">
        Informatif uniquement. Le nom original reste la référence.
      </p>
    </div>
  );
}
