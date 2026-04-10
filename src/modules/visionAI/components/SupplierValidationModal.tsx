/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — SupplierValidationModal (Step 1 of 3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Blocking modal that appears after extraction if supplier is not validated.
 * User must:
 * - Select an existing supplier, OR
 * - Create a new supplier
 *
 * Only after supplier validation will the products modal open.
 *
 * SSOT: validatedSupplierId lives in VisionAI.tsx (parent)
 * This modal only calls onSupplierValidated callback — no local SSOT.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Building2, Plus, Search, Loader2, X, Brain, Sparkles } from "lucide-react";
import { useSupplierMatch, createSupplier } from "@/modules/fournisseurs";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";
import { logSupplierConfirmed, logSupplierConfirmedHeaderPicker } from "@/modules/theBrain";
import { getBestSupplierRuleSuggestion, THE_BRAIN_DISABLED } from "@/modules/theBrain";
import type { BrainSupplierSuggestion } from "@/modules/theBrain";

interface SupplierValidationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Supplier name extracted from invoice (for display context) */
  extractedSupplierName: string | null;
  /** Callback when user validates a supplier */
  onSupplierValidated: (supplierId: string, supplierName: string) => void;
  /** Callback when user cancels (triggers fullReset) */
  onCancel: () => void;
}

export function SupplierValidationModal({
  open,
  onOpenChange,
  extractedSupplierName,
  onSupplierValidated,
  onCancel,
}: SupplierValidationModalProps) {
  const { activeEstablishment } = useEstablishment();
  const { suppliers, isLoading: suppliersLoading } = useSupplierMatch();

  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  // Create new supplier state
  const [newSupplierName, setNewSupplierName] = useState(extractedSupplierName ?? "");
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateMode, setShowCreateMode] = useState(false);

  // THE BRAIN suggestion state
  const [brainSuggestion, setBrainSuggestion] = useState<BrainSupplierSuggestion | null>(null);
  const [suggestedSupplierName, setSuggestedSupplierName] = useState<string | null>(null);

  // Fetch BRAIN suggestion when modal opens
  useEffect(() => {
    if (!open || !activeEstablishment || !extractedSupplierName || THE_BRAIN_DISABLED) {
      setBrainSuggestion(null);
      setSuggestedSupplierName(null);
      return;
    }

    // Fetch suggestion from brain_rules
    getBestSupplierRuleSuggestion({
      establishmentId: activeEstablishment.id,
      extractedLabel: extractedSupplierName,
    }).then((suggestion) => {
      if (suggestion) {
        setBrainSuggestion(suggestion);
        // Lookup supplier name
        const found = suppliers.find((s) => s.id === suggestion.supplierId);
        setSuggestedSupplierName(found?.name ?? null);
      } else {
        setBrainSuggestion(null);
        setSuggestedSupplierName(null);
      }
    });
  }, [open, activeEstablishment, extractedSupplierName, suppliers]);

  // Handle using BRAIN suggestion
  const handleUseBrainSuggestion = useCallback(() => {
    if (!brainSuggestion || !suggestedSupplierName || !activeEstablishment) return;

    // Notify parent (SSOT update)
    onSupplierValidated(brainSuggestion.supplierId, suggestedSupplierName);

    // THE BRAIN: Log human action (still counts as confirmed)
    logSupplierConfirmedHeaderPicker({
      establishmentId: activeEstablishment.id,
      supplierId: brainSuggestion.supplierId,
      supplierName: suggestedSupplierName,
      extractedSupplierLabel: extractedSupplierName || "",
    });

    onOpenChange(false);
  }, [
    brainSuggestion,
    suggestedSupplierName,
    activeEstablishment,
    extractedSupplierName,
    onSupplierValidated,
    onOpenChange,
  ]);

  // Filtered suppliers for search
  const filteredSuppliers = useMemo(() => {
    if (!searchQuery.trim()) return suppliers.slice(0, 20);
    const query = searchQuery.toLowerCase();
    return suppliers.filter((s) => s.name.toLowerCase().includes(query)).slice(0, 20);
  }, [suppliers, searchQuery]);

  // Handle selecting an existing supplier
  const handleSelectSupplier = useCallback(
    (supplier: { id: string; name: string }) => {
      if (!activeEstablishment) return;

      // Notify parent (SSOT update)
      onSupplierValidated(supplier.id, supplier.name);

      // THE BRAIN: Log human action
      logSupplierConfirmedHeaderPicker({
        establishmentId: activeEstablishment.id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        extractedSupplierLabel: extractedSupplierName || "",
      });

      onOpenChange(false);
    },
    [activeEstablishment, extractedSupplierName, onSupplierValidated, onOpenChange]
  );

  // Handle creating a new supplier
  const handleCreateSupplier = useCallback(async () => {
    if (!newSupplierName.trim() || !activeEstablishment) return;

    setIsCreating(true);
    try {
      const result = await createSupplier({
        name: newSupplierName.trim(),
        establishment_id: activeEstablishment.id,
        organization_id: activeEstablishment.organization_id,
      });

      if (result.success && result.data) {
        toast.success("Fournisseur créé");

        // Notify parent (SSOT update)
        onSupplierValidated(result.data.id, result.data.name);

        // THE BRAIN: Log human action
        logSupplierConfirmed({
          establishmentId: activeEstablishment.id,
          supplierId: result.data.id,
          extractedSupplierLabel: newSupplierName.trim(),
          matchKind: "manual",
        });

        onOpenChange(false);
      } else {
        toast.error(result.error || "Erreur lors de la création");
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error("[SupplierValidationModal] Create error:", error);
      toast.error("Erreur lors de la création");
    } finally {
      setIsCreating(false);
    }
  }, [newSupplierName, activeEstablishment, onSupplierValidated, onOpenChange]);

  // Handle cancel — triggers fullReset in parent
  const handleCancel = useCallback(() => {
    onCancel();
    onOpenChange(false);
  }, [onCancel, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          // User closed the modal without selecting → cancel
          handleCancel();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Valider le fournisseur
          </DialogTitle>
          <DialogDescription>
            {extractedSupplierName ? (
              <>
                Nom extrait :{" "}
                <span className="font-medium text-foreground">"{extractedSupplierName}"</span>
              </>
            ) : (
              "Aucun fournisseur détecté. Sélectionnez ou créez un fournisseur."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* THE BRAIN SUGGESTION */}
          {brainSuggestion && suggestedSupplierName && !showCreateMode && (
            <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Suggestion THE BRAIN</span>
                <Badge variant="secondary" className="text-xs">
                  {brainSuggestion.confirmationsCount} confirmation
                  {brainSuggestion.confirmationsCount > 1 ? "s" : ""}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  Fournisseur suggéré :{" "}
                  <span className="font-medium text-foreground">{suggestedSupplierName}</span>
                </span>
                <Button size="sm" onClick={handleUseBrainSuggestion} className="shrink-0">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Utiliser
                </Button>
              </div>
            </div>
          )}

          {/* MODE: Search existing suppliers */}
          {!showCreateMode && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Rechercher un fournisseur existant</Label>

              <Command className="border rounded-lg">
                <CommandInput
                  placeholder="Tapez pour rechercher..."
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                />
                <CommandList className="max-h-48">
                  {suppliersLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      <CommandEmpty>Aucun fournisseur trouvé</CommandEmpty>
                      <CommandGroup>
                        {filteredSuppliers.map((supplier) => (
                          <CommandItem
                            key={supplier.id}
                            value={supplier.name}
                            onSelect={() => handleSelectSupplier(supplier)}
                            className="cursor-pointer"
                          >
                            <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                            {supplier.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">ou</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setShowCreateMode(true);
                  setNewSupplierName(extractedSupplierName ?? searchQuery);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer un nouveau fournisseur
              </Button>
            </div>
          )}

          {/* MODE: Create new supplier */}
          {showCreateMode && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Nouveau fournisseur</Label>
                <Button variant="ghost" size="sm" onClick={() => setShowCreateMode(false)}>
                  <Search className="h-4 w-4 mr-1" />
                  Rechercher
                </Button>
              </div>

              <Input
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="Nom du fournisseur"
                autoFocus
              />

              <Button
                className="w-full"
                onClick={handleCreateSupplier}
                disabled={!newSupplierName.trim() || isCreating}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Création...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Créer "{newSupplierName.trim()}"
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleCancel}>
            <X className="h-4 w-4 mr-2" />
            Annuler l'extraction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
