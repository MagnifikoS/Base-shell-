import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Check, AlertCircle, Loader2, Package, Lock } from "lucide-react";
import { InvoiceData } from "../types";
import type { Invoice } from "@/modules/factures";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createInvoice } from "@/modules/factures";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { uploadInvoicePdf } from "../utils/invoiceStorage";
import { useSupplierMatch } from "@/modules/fournisseurs";
import { queryClient } from "@/lib/queryClient";

/**
 * Result from invoice validation attempt
 * Enriched with invoice object for downstream processing (e.g., Achat module)
 */
export interface InvoiceValidateResult {
  ok: boolean;
  errorMessage?: string;
  /** Created invoice object (only present if ok === true) */
  invoice?: Invoice;
}

interface InvoiceHeaderProps {
  invoice: InvoiceData;
  invoiceValidated: boolean;
  pendingItemsCount: number;
  validatedSupplierId: string | null;
  validatedSupplierName: string | null;
  pdfFile: File | null;
  /** Show validate button only when products are validated */
  showValidateButton?: boolean;
  /** One-shot trigger: when this changes to a new value, validation is triggered */
  validateRequestId?: number | null;
  /** Callback when validation completes (success or error) */
  onValidateFinished?: (result: InvoiceValidateResult) => void;
  onUpdate: (data: Partial<InvoiceData>) => void;
  onValidate: () => void;
  onSupplierValidated: (supplierId: string, supplierName: string) => void;
  /** Replace mode: delete this invoice before creating the new one */
  replaceInvoiceId?: string | null;
  replaceFilePath?: string | null;
}

export function InvoiceHeader({
  invoice,
  invoiceValidated,
  pendingItemsCount,
  validatedSupplierId,
  validatedSupplierName,
  pdfFile,
  showValidateButton = false,
  validateRequestId,
  onValidateFinished,
  onUpdate,
  onValidate,
  onSupplierValidated,
  replaceInvoiceId,
  replaceFilePath,
}: InvoiceHeaderProps) {
  const [showIncompleteDialog, setShowIncompleteDialog] = useState(false);
  const [showPendingProductsDialog, setShowPendingProductsDialog] = useState(false);
  const [showSupplierRequiredDialog, setShowSupplierRequiredDialog] = useState(false);
  const [showNoPdfDialog, setShowNoPdfDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { activeEstablishment } = useEstablishment();
  const { findMatch, isLoading: suppliersLoading, suppliers } = useSupplierMatch();

  // Auto-match on mount — calls onSupplierValidated to update parent SSOT
  useEffect(() => {
    // Only auto-match if no supplier already validated AND we have a name to match
    if (
      validatedSupplierId === null &&
      invoice.supplier_name &&
      !suppliersLoading &&
      suppliers.length > 0
    ) {
      const result = findMatch(invoice.supplier_name);
      if (
        (result.type === "exact" || result.similarity === 1) &&
        result.supplierId &&
        result.supplierName
      ) {
        onSupplierValidated(result.supplierId, result.supplierName);
        // ⚠️ NO BRAIN LOG: auto-match is not a human action
      }
    }
  }, [
    invoice.supplier_name,
    suppliersLoading,
    suppliers.length,
    validatedSupplierId,
    findMatch,
    onSupplierValidated,
  ]);

  // Validation rules — SSOT: validatedSupplierId from props only
  const hasReference = invoice.invoice_number !== null && invoice.invoice_number.trim() !== "";
  const hasDate = invoice.invoice_date !== null && invoice.invoice_date.trim() !== "";
  const hasTotal = invoice.invoice_total !== null && invoice.invoice_total > 0;
  const hasValidatedSupplier = validatedSupplierId !== null;
  const hasPdf = pdfFile !== null;
  const fieldsComplete = hasReference && hasDate && hasTotal;
  const allProductsProcessed = pendingItemsCount === 0;
  const canValidate = fieldsComplete && hasValidatedSupplier && allProductsProcessed && hasPdf;

  /**
   * Core validation logic - uploads PDF and creates invoice in DB
   * Returns { ok, errorMessage } for programmatic callers
   */
  const handleValidateClick = async (): Promise<InvoiceValidateResult> => {
    if (!hasPdf) {
      setShowNoPdfDialog(true);
      return { ok: false, errorMessage: "PDF non disponible" };
    }
    if (!hasValidatedSupplier) {
      setShowSupplierRequiredDialog(true);
      return { ok: false, errorMessage: "Fournisseur requis" };
    }
    if (!fieldsComplete) {
      setShowIncompleteDialog(true);
      return { ok: false, errorMessage: "Informations incomplètes" };
    }
    if (!allProductsProcessed) {
      setShowPendingProductsDialog(true);
      return { ok: false, errorMessage: "Produits non traités" };
    }
    if (!activeEstablishment) {
      toast.error("Aucun établissement sélectionné");
      return { ok: false, errorMessage: "Établissement manquant" };
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) {
      toast.error("Session expirée");
      return { ok: false, errorMessage: "Session expirée" };
    }

    // Prevent double submit
    if (isSubmitting) {
      return { ok: false, errorMessage: "Validation en cours" };
    }

    setIsSubmitting(true);
    try {
      // Use SSOT from props only — no fallback to local state
      const supplierId = validatedSupplierId!;
      const supplierDisplayName = validatedSupplierName;

      const uploadResult = await uploadInvoicePdf(
        pdfFile!,
        activeEstablishment.id,
        supplierId!,
        invoice.invoice_date!
      );
      if (!uploadResult.success) {
        const errMsg = uploadResult.error || "Erreur upload";
        toast.error(errMsg);
        return { ok: false, errorMessage: errMsg };
      }

      const replaceOptions = replaceInvoiceId
        ? { replaceInvoiceId, replaceFilePath: replaceFilePath || "" }
        : undefined;

      const result = await createInvoice(
        {
          establishment_id: activeEstablishment.id,
          organization_id: activeEstablishment.organization_id,
          supplier_id: supplierId!,
          supplier_name: supplierDisplayName,
          invoice_number: invoice.invoice_number!,
          invoice_date: invoice.invoice_date!,
          amount_eur: invoice.invoice_total!,
          file_path: uploadResult.path!,
          file_name: uploadResult.fileName || pdfFile!.name,
          file_size: uploadResult.fileSize || pdfFile!.size,
          file_type: "application/pdf",
          created_by: userId,
        },
        replaceOptions
      );

      if (!result.success) {
        const errMsg = result.error || "Erreur";
        toast.error(errMsg);
        return { ok: false, errorMessage: errMsg };
      }

      // Invalidate factures cache so the list refreshes on /factures page
      queryClient.invalidateQueries({ queryKey: ["factures"] });

      toast.success("Facture enregistrée");
      onValidate();
      // Return invoice for downstream processing (Achat module)
      return { ok: true, invoice: result.invoice };
    } catch (error) {
      if (import.meta.env.DEV) console.error("[InvoiceHeader] error:", error);
      const errMsg = error instanceof Error ? error.message : "Erreur lors de l'enregistrement";
      toast.error(errMsg);
      return { ok: false, errorMessage: errMsg };
    } finally {
      setIsSubmitting(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ONE-SHOT TRIGGER: Programmatic validation via validateRequestId
  // When validateRequestId changes to a new value, trigger handleValidateClick
  // ═══════════════════════════════════════════════════════════════════════════
  const lastRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    // Only trigger if validateRequestId is a new value (not null, not same as last)
    if (
      validateRequestId !== null &&
      validateRequestId !== undefined &&
      validateRequestId !== lastRequestIdRef.current
    ) {
      lastRequestIdRef.current = validateRequestId;

      // Execute validation and report result
      handleValidateClick().then((result) => {
        if (onValidateFinished) {
          onValidateFinished(result);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validateRequestId]); // Only depend on validateRequestId to avoid re-triggers

  // Display state — derived from props SSOT only
  const isSupplierValidatedDisplay = validatedSupplierId !== null;
  const effectiveSupplierName = validatedSupplierName ?? invoice.supplier_name;

  return (
    <>
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Fournisseur - Read-only display (actions are in SupplierValidationModal) */}
          <div className="flex items-center gap-3">
            <Label className="text-sm font-medium shrink-0">Fournisseur</Label>
            {isSupplierValidatedDisplay ? (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 border border-primary/20 rounded-lg flex-1">
                <Lock className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium text-sm">{effectiveSupplierName}</span>
                <Check className="h-3.5 w-3.5 text-primary ml-auto" />
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border border-border rounded-lg flex-1">
                <span className="text-sm text-muted-foreground">
                  {invoice.supplier_name || "Non défini — à valider"}
                </span>
              </div>
            )}
          </div>

          {/* Ref / Date / Montant + Valider (si showValidateButton) */}
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invoice_number" className="text-xs text-muted-foreground">
                Référence
              </Label>
              <Input
                id="invoice_number"
                value={invoice.invoice_number ?? ""}
                onChange={(e) => onUpdate({ invoice_number: e.target.value || null })}
                disabled={invoiceValidated}
                className="h-9"
              />
            </div>

            <div className="w-36 space-y-1.5">
              <Label htmlFor="invoice_date" className="text-xs text-muted-foreground">
                Date
              </Label>
              <Input
                id="invoice_date"
                type="date"
                value={invoice.invoice_date ?? ""}
                onChange={(e) => onUpdate({ invoice_date: e.target.value || null })}
                disabled={invoiceValidated}
                className="h-9"
              />
            </div>

            <div className="w-32 space-y-1.5">
              <Label htmlFor="invoice_total" className="text-xs text-muted-foreground">
                Montant (€)
              </Label>
              <Input
                id="invoice_total"
                type="number"
                step="0.01"
                value={invoice.invoice_total ?? ""}
                onChange={(e) =>
                  onUpdate({ invoice_total: e.target.value ? parseFloat(e.target.value) : null })
                }
                disabled={invoiceValidated}
                className="h-9"
              />
            </div>

            {/* Validate button - only visible when showValidateButton is true */}
            {showValidateButton && !invoiceValidated && (
              <Button
                onClick={handleValidateClick}
                disabled={isSubmitting || !canValidate}
                className="shrink-0"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Valider la facture
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <AlertDialog open={showSupplierRequiredDialog} onOpenChange={setShowSupplierRequiredDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fournisseur requis</AlertDialogTitle>
            <AlertDialogDescription>
              Vous devez valider ou créer un fournisseur avant d'enregistrer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showIncompleteDialog} onOpenChange={setShowIncompleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Informations incomplètes</AlertDialogTitle>
            <AlertDialogDescription>
              Renseignez la référence, la date et le montant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showPendingProductsDialog} onOpenChange={setShowPendingProductsDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-warning" />
              Produits non traités
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tous les produits doivent être validés ou supprimés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showNoPdfDialog} onOpenChange={setShowNoPdfDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              PDF non disponible
            </AlertDialogTitle>
            <AlertDialogDescription>
              Le fichier PDF n'est plus disponible. Réimportez le document.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
