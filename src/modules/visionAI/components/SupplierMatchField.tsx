/**
 * Supplier Selection/Match Component for Vision AI V2
 *
 * Implements 3-tier matching with full UX:
 * 1. EXACT MATCH → field locked, auto-validated badge
 * 2. NEAR MATCH → dropdown with top 3 suggestions + scores
 * 3. NO MATCH → free editable field with create button
 *
 * RULES:
 * - Auto-validate on exact match (100%)
 * - Manual edit de-validates and re-runs matching
 * - Create button only visible when no validated supplier
 * - Field locks after validation
 *
 * THE BRAIN INTEGRATION (Phase 1):
 * - Log confirmed/corrected events for human actions only
 * - NO logging for auto-match 100% (no human action)
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, AlertCircle, Plus, Building2, Lock, Loader2 } from "lucide-react";
import {
  useSupplierMatch,
  createSupplier,
  recomputeMatch,
  type SupplierMatchResult,
} from "@/modules/fournisseurs";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";
import { logSupplierConfirmed } from "@/modules/theBrain";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SupplierMatchFieldProps {
  extractedName: string | null;
  onSupplierValidated: (supplierId: string, supplierName: string) => void;
  disabled?: boolean;
}

export function SupplierMatchField({
  extractedName,
  onSupplierValidated,
  disabled = false,
}: SupplierMatchFieldProps) {
  const { activeEstablishment } = useEstablishment();
  const { findMatch, isLoading: suppliersLoading, suppliers } = useSupplierMatch();

  const [matchResult, setMatchResult] = useState<SupplierMatchResult | null>(null);
  const [isValidated, setIsValidated] = useState(false);
  const [validatedSupplier, setValidatedSupplier] = useState<{ id: string; name: string } | null>(
    null
  );
  const [isCreating, setIsCreating] = useState(false);
  const [manualName, setManualName] = useState("");
  const [hasManuallyEdited, setHasManuallyEdited] = useState(false);

  // Initial match computation
  useEffect(() => {
    if (extractedName && !suppliersLoading && !hasManuallyEdited) {
      const result = findMatch(extractedName);
      setMatchResult(result);
      setManualName(extractedName);

      // Auto-validate for exact match OR 100% similarity (fuzzy perfect match)
      const isPerfectMatch = result.type === "exact" || result.similarity === 1;
      if (isPerfectMatch && result.supplierId && result.supplierName) {
        setIsValidated(true);
        setValidatedSupplier({ id: result.supplierId, name: result.supplierName });
        onSupplierValidated(result.supplierId, result.supplierName);
      }
    }
  }, [extractedName, suppliersLoading, findMatch, onSupplierValidated, hasManuallyEdited]);

  // Re-match when manual name changes
  const handleManualNameChange = useCallback(
    (newName: string) => {
      setManualName(newName);
      setHasManuallyEdited(true);

      // De-validate if previously validated
      if (isValidated) {
        setIsValidated(false);
        setValidatedSupplier(null);
      }

      // Re-run matching
      if (newName.trim() && suppliers.length > 0) {
        const result = recomputeMatch(newName, suppliers);
        setMatchResult(result);

        // Auto-validate on exact match OR 100% similarity
        const isPerfectMatch = result.type === "exact" || result.similarity === 1;
        if (isPerfectMatch && result.supplierId && result.supplierName) {
          setIsValidated(true);
          setValidatedSupplier({ id: result.supplierId, name: result.supplierName });
          onSupplierValidated(result.supplierId, result.supplierName);
        }
      } else {
        setMatchResult(null);
      }
    },
    [isValidated, suppliers, onSupplierValidated]
  );

  // Handle selecting an existing supplier from suggestions
  const handleSelectSuggestion = useCallback(
    (supplierId: string) => {
      const suggestion = matchResult?.suggestions.find((s) => s.id === supplierId);
      if (suggestion) {
        setIsValidated(true);
        setValidatedSupplier({ id: suggestion.id, name: suggestion.name });
        onSupplierValidated(suggestion.id, suggestion.name);

        // THE BRAIN: Log human action (fuzzy match selection)
        if (activeEstablishment?.id) {
          logSupplierConfirmed({
            establishmentId: activeEstablishment.id,
            supplierId: suggestion.id,
            extractedSupplierLabel: extractedName ?? manualName,
            matchKind: "fuzzy",
          });
        }
      }
    },
    [matchResult, onSupplierValidated, activeEstablishment?.id, extractedName, manualName]
  );

  // Handle using best match
  const handleUseBestMatch = useCallback(() => {
    if (matchResult?.supplierId && matchResult?.supplierName) {
      setIsValidated(true);
      setValidatedSupplier({ id: matchResult.supplierId, name: matchResult.supplierName });
      onSupplierValidated(matchResult.supplierId, matchResult.supplierName);

      // THE BRAIN: Log human action (best match click)
      if (activeEstablishment?.id) {
        logSupplierConfirmed({
          establishmentId: activeEstablishment.id,
          supplierId: matchResult.supplierId,
          extractedSupplierLabel: extractedName ?? manualName,
          matchKind: "fuzzy",
        });
      }
    }
  }, [matchResult, onSupplierValidated, activeEstablishment?.id, extractedName, manualName]);

  // Handle creating a new supplier
  const handleCreateNew = async () => {
    const nameToCreate = manualName.trim();
    if (!nameToCreate || !activeEstablishment) return;

    setIsCreating(true);
    try {
      const result = await createSupplier({
        name: nameToCreate,
        establishment_id: activeEstablishment.id,
        organization_id: activeEstablishment.organization_id,
      });

      if (result.success && result.data) {
        toast.success("Fournisseur créé avec succès");
        setIsValidated(true);
        setValidatedSupplier({ id: result.data.id, name: result.data.name });
        onSupplierValidated(result.data.id, result.data.name);

        // THE BRAIN: Log human action (manual creation)
        logSupplierConfirmed({
          establishmentId: activeEstablishment.id,
          supplierId: result.data.id,
          extractedSupplierLabel: nameToCreate,
          matchKind: "manual",
        });
      } else {
        toast.error(result.error || "Erreur lors de la création");
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error("[SupplierMatchField] Create error:", error);
      toast.error("Erreur lors de la création du fournisseur");
    } finally {
      setIsCreating(false);
    }
  };

  // Loading state
  if (suppliersLoading) {
    return (
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Chargement des fournisseurs...</span>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE: VALIDATED (locked)
  // ═══════════════════════════════════════════════════════════════════════════
  if (isValidated && validatedSupplier) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <Lock className="h-4 w-4 text-primary flex-shrink-0" />
          <div className="flex-1">
            <div className="font-medium">{validatedSupplier.name}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Check className="h-3 w-3 text-primary" />
              {matchResult?.type === "exact" ? "Validé automatiquement" : "Fournisseur validé"}
            </div>
          </div>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            <Check className="h-3 w-3 mr-1" />
            SSOT
          </Badge>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE: NEAR MATCH (suggestions dropdown)
  // ═══════════════════════════════════════════════════════════════════════════
  if (matchResult?.type === "near" && matchResult.suggestions.length > 0) {
    return (
      <div className="space-y-3">
        {/* Input for manual editing */}
        <Input
          value={manualName}
          onChange={(e) => handleManualNameChange(e.target.value)}
          placeholder="Nom du fournisseur"
          disabled={disabled}
        />

        {/* Suggestion panel */}
        <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium">Fournisseurs similaires trouvés</div>
              <div className="text-xs text-muted-foreground mt-1">
                Nom extrait : "{extractedName}"
              </div>
            </div>
          </div>

          {/* Dropdown with suggestions */}
          <Select onValueChange={handleSelectSuggestion}>
            <SelectTrigger className="w-full bg-background">
              <SelectValue placeholder="Choisir un fournisseur existant" />
            </SelectTrigger>
            <SelectContent>
              {matchResult.suggestions.map((suggestion) => (
                <SelectItem key={suggestion.id} value={suggestion.id}>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span>{suggestion.name}</span>
                    <Badge
                      variant="outline"
                      className={`text-xs ml-auto ${
                        suggestion.similarity >= 0.9
                          ? "border-primary text-primary"
                          : "border-warning text-warning"
                      }`}
                    >
                      {Math.round(suggestion.similarity * 100)}%
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Quick action: use best match */}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleUseBestMatch} disabled={disabled} className="flex-1">
              <Check className="h-4 w-4 mr-1" />
              Utiliser : {matchResult.supplierName} ({Math.round(matchResult.similarity * 100)}%)
            </Button>
          </div>

          {/* Create new option */}
          <div className="border-t border-warning/20 pt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCreateNew}
              disabled={disabled || isCreating || !manualName.trim()}
              className="w-full"
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Création...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Créer "{manualName.trim()}" comme nouveau fournisseur
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE: NO MATCH (free field + create button)
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-2">
      <Input
        value={manualName}
        onChange={(e) => handleManualNameChange(e.target.value)}
        placeholder="Nom du fournisseur"
        disabled={disabled}
      />

      {matchResult?.type === "none" && manualName.trim() && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {matchResult.message}
        </div>
      )}

      {manualName.trim() && (
        <Button
          size="sm"
          onClick={handleCreateNew}
          disabled={disabled || isCreating || !manualName.trim()}
        >
          {isCreating ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Création...
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-1" />
              Créer le fournisseur
            </>
          )}
        </Button>
      )}
    </div>
  );
}
