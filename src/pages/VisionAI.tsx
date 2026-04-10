import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Settings, FileText, AlertTriangle, Package, X, History } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// Direct imports to avoid Rollup circular chunk warnings through barrel re-exports
import { ExtractionProgressModal } from "@/modules/visionAI/components/ExtractionProgressModal";
import { InvoiceHeader } from "@/modules/visionAI/components/InvoiceHeader";
import { InsightsPanel } from "@/modules/visionAI/components/InsightsPanel";
import { DuplicateInvoiceDialog } from "@/modules/visionAI/components/DuplicateInvoiceDialog";
import { ExtractedProductsModal } from "@/modules/visionAI/components/ExtractedProductsModal";
import { SupplierValidationModal } from "@/modules/visionAI/components/SupplierValidationModal";
import { InvoiceSavingModal } from "@/modules/visionAI/components/InvoiceSavingModal";
import { FilteredProductsBanner } from "@/modules/visionAI/components/FilteredProductsBanner";
import { VisionAIEmptyState } from "@/modules/visionAI/components/VisionAIEmptyState";
import { VisionAIInvoiceHistory } from "@/modules/visionAI/components/VisionAIInvoiceHistory";
import { ScanHistoryTab } from "@/modules/visionAI/components/scanHistory";
import { BLReviewModal } from "@/modules/visionAI/components/BLReviewModal";
import { ReleveReconciliationModal } from "@/modules/visionAI/components/ReleveReconciliationModal";
import { VisionAISettings } from "@/components/settings/VisionAISettings";
import { ExtractionSettingsPanel } from "@/modules/analyseFacture";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useVisionAIState } from "./useVisionAIState";

/**
 * VISION AI PAGE -- SAS ARCHITECTURE + 3 MODALS FLOW
 *
 * State and handlers extracted to useVisionAIState.ts for file size compliance.
 * This file contains only the JSX rendering.
 */
export default function VisionAI() {
  const state = useVisionAIState();
  const [activeTab, setActiveTab] = useState("extraction");

  return (
    <ResponsiveLayout>
      <div className="container mx-auto py-6 px-4 max-w-4xl">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Only show tabs when NOT in active extraction mode */}
          {!state.hasExtractionData && !state.isLoading && (
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="extraction" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Extraction
              </TabsTrigger>
              <TabsTrigger value="history" className="flex items-center gap-2">
                <History className="h-4 w-4" />
                Historique des scans
              </TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="extraction" className="mt-0">
            {/* EMPTY STATE: No extraction data */}
            {!state.hasExtractionData && !state.isLoading && !state.documentHook.isLoading && (
              <>
                <VisionAIEmptyState
                  isLoading={state.isLoading}
                  onImport={state.handleImportClick}
                  onSettingsOpen={() => state.setSettingsOpen(true)}
                  fileInputRef={state.fileInputRef}
                  onFileChange={state.handleFileChange}
                  onFileDrop={state.handleFileDrop}
                />
              </>
            )}

            {/* LOADING STATE: Show loading empty state */}
            {(state.isLoading || state.documentHook.isLoading) && !state.hasExtractionData && (
              <VisionAIEmptyState
                isLoading={true}
                onImport={state.handleImportClick}
                onSettingsOpen={() => state.setSettingsOpen(true)}
                fileInputRef={state.fileInputRef}
                onFileChange={state.handleFileChange}
                onFileDrop={state.handleFileDrop}
              />
            )}

            {/* ERROR STATE: BL/Releve extraction error */}
            {state.documentHook.error && !state.documentHook.isLoading && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <span>{state.documentHook.error}</span>
                </div>
                <Button variant="outline" onClick={state.fullReset}>
                  Recommencer
                </Button>
              </div>
            )}

            {/* ERROR STATE: Facture extraction error (shown when extraction fails and no data) */}
            {state.error && !state.isLoading && !state.hasExtractionData && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <span>{state.error}</span>
                </div>
                <Button variant="outline" onClick={state.fullReset}>
                  Recommencer
                </Button>
              </div>
            )}

            {/* ACTIVE STATE: Has extraction data (FACTURE MODE ONLY) */}
            {state.hasExtractionData &&
              !state.documentHook.blResponse &&
              !state.documentHook.releveResponse && (
                <div className="space-y-4">
                  {/* Header with actions */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h1 className="text-xl font-semibold tracking-tight">Vision AI</h1>
                        <p className="text-sm text-muted-foreground">
                          Document en cours de traitement
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => state.setSettingsOpen(true)}
                        className="text-muted-foreground"
                        aria-label="Paramètres"
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                      {!state.invoiceValidated && (
                        <Button
                          onClick={state.handleCancelExtraction}
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-4 w-4 mr-1" />
                          Annuler
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Error display */}
                  {state.error && (
                    <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
                      <AlertCircle className="h-5 w-5 flex-shrink-0" />
                      <span>{state.error}</span>
                    </div>
                  )}

                  {/* Invoice Header */}
                  <InvoiceHeader
                    invoice={state.invoice}
                    invoiceValidated={state.invoiceValidated}
                    pendingItemsCount={state.productsValidated ? 0 : state.displayItems.length}
                    validatedSupplierId={state.validatedSupplierId}
                    validatedSupplierName={state.validatedSupplierName}
                    pdfFile={state.getPdfFile()}
                    showValidateButton={false}
                    validateRequestId={state.validateRequestId}
                    onValidateFinished={state.handleValidateFinished}
                    onUpdate={state.updateInvoice}
                    onValidate={state.handleInvoiceValidate}
                    onSupplierValidated={state.handleSupplierValidated}
                    replaceInvoiceId={state.replaceInvoiceId}
                    replaceFilePath={state.replaceFilePath}
                  />

                  {/* EXTRACTION MODE: Before products validated */}
                  {!state.productsValidated && (
                    <>
                      <Button
                        onClick={() => {
                          if (state.validatedSupplierId === null) {
                            state.setSupplierModalOpen(true);
                          } else {
                            state.setProductsModalOpen(true);
                          }
                        }}
                        className="w-full"
                        size="lg"
                      >
                        <Package className="h-4 w-4 mr-2" />
                        Voir les produits ({state.displayItems.length})
                      </Button>

                      {state.filteredOutCount > 0 && state.items.length > 0 && (
                        <FilteredProductsBanner
                          filteredOutCount={state.filteredOutCount}
                          showFiltered={state.showFilteredProducts}
                          onToggle={state.handleToggleFilteredProducts}
                        />
                      )}
                    </>
                  )}

                  {/* RECAP MODE: After products validated */}
                  {state.productsValidated && (
                    <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                      <span className="text-sm">
                        {state.items.length} produit{state.items.length > 1 ? "s" : ""} validé
                        {state.items.length > 1 ? "s" : ""}
                      </span>
                    </div>
                  )}

                  {/* Insights panel */}
                  {(state.insights.length > 0 ||
                    state.items.some((i) => i.category_suggestion)) && (
                    <div className="border border-border/50 rounded-lg">
                      <InsightsPanel insights={state.insights} items={state.items} />
                    </div>
                  )}
                </div>
              )}
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <ScanHistoryTab />
            <VisionAIInvoiceHistory className="mt-6" />
          </TabsContent>
        </Tabs>

        {/* Settings dialog */}
        <Dialog open={state.settingsOpen} onOpenChange={state.setSettingsOpen}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Parametres Vision AI</DialogTitle>
              <DialogDescription>
                Configurez le comportement de l'extraction automatique et les unites de conversion.
              </DialogDescription>
            </DialogHeader>
            <Tabs defaultValue="extraction" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="extraction">Regles de validation</TabsTrigger>
                <TabsTrigger value="vision">Unites et moteur</TabsTrigger>
              </TabsList>
              <TabsContent value="extraction" className="mt-4">
                <ExtractionSettingsPanel />
              </TabsContent>
              <TabsContent value="vision" className="mt-4">
                <VisionAISettings />
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        {/* Lock Explanation Dialog */}
        <Dialog open={state.lockDialogOpen} onOpenChange={state.setLockDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-12 w-12 rounded-full bg-warning/20 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-warning" />
                </div>
                <DialogTitle className="text-xl">Import verrouillé</DialogTitle>
              </div>
              <DialogDescription className="text-base pt-2 space-y-3">
                <p>
                  Vous devez d'abord valider les produits extraits avant d'importer une nouvelle
                  facture.
                </p>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4 flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  state.fullReset();
                  state.setLockDialogOpen(false);
                  state.fileInputRef.current?.click();
                }}
              >
                Passer et importer
              </Button>
              <Button
                onClick={() => {
                  state.setLockDialogOpen(false);
                  if (state.validatedSupplierId === null) {
                    state.setSupplierModalOpen(true);
                  } else {
                    state.setProductsModalOpen(true);
                  }
                }}
              >
                Valider les produits
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Duplicate Invoice Dialog */}
        <DuplicateInvoiceDialog
          open={state.showDuplicatePopup ?? false}
          onOpenChange={(open) => {
            if (!open) {
              state.fullReset();
            }
          }}
          duplicateResult={state.duplicateResult ?? null}
          onImportNew={() => {
            state.fullReset();
            state.fileInputRef.current?.click();
          }}
          onContinueReview={state.handleDuplicateContinueReview}
          onReplace={state.handleDuplicateReplace}
        />

        {/* MODAL 1: Supplier Validation Modal */}
        <SupplierValidationModal
          open={state.supplierModalOpen}
          onOpenChange={state.setSupplierModalOpen}
          extractedSupplierName={state.invoice.supplier_name}
          onSupplierValidated={state.handleSupplierValidated}
          onCancel={state.handleCancelExtraction}
        />

        {/* MODAL 2: Extracted Products Modal */}
        <ExtractedProductsModal
          open={state.productsModalOpen}
          onOpenChange={state.setProductsModalOpen}
          items={state.displayItems}
          supplierName={state.validatedSupplierName ?? state.invoice.supplier_name}
          supplierId={state.validatedSupplierId}
          onAllValidated={state.handleProductsValidated}
          onAllProductsResolved={state.handleAllProductsResolved}
        />

        {/* MODAL 3: Invoice Saving Modal */}
        <InvoiceSavingModal
          open={state.savingModalOpen}
          onOpenChange={state.setSavingModalOpen}
          status={state.savingStatus}
          errorMessage={state.savingErrorMessage}
          invoiceNumber={state.invoice.invoice_number}
          supplierName={state.validatedSupplierName ?? state.invoice.supplier_name}
          onRetry={state.handleSavingRetry}
          onCancel={state.handleSavingCancel}
          onSuccess={state.handleSavingSuccess}
        />

        <ExtractionProgressModal
          open={state.isLoading || state.documentHook.isLoading}
          onOpenChange={() => {}}
        />

        {/* PDF Pre-validation Error Dialog */}
        <Dialog
          open={!!state.pdfValidationError}
          onOpenChange={(open) => {
            if (!open) state.setPdfValidationError(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                {state.pdfValidationError?.title}
              </DialogTitle>
              <DialogDescription className="text-sm pt-2 leading-relaxed">
                {state.pdfValidationError?.description}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => state.setPdfValidationError(null)}>
                Compris
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* BL: Supplier Picker (BLOCKING — must happen before product review) */}
        <SupplierValidationModal
          open={state.blSupplierModalOpen}
          onOpenChange={state.handleBLSupplierOnOpenChange}
          extractedSupplierName={state.blExtractedSupplierName}
          onSupplierValidated={state.handleBLSupplierValidated}
          onCancel={state.handleBLSupplierCancel}
        />

        {/* BL Review Modal */}
        <BLReviewModal
          open={state.blModalOpen}
          onOpenChange={state.setBlModalOpen}
          blResponse={state.documentHook.blResponse}
          onValidated={state.handleBLValidated}
          onCancel={state.handleBLCancel}
          knownSupplierId={state.blSupplierId}
        />

        {/* Relevé: Supplier Picker (BLOCKING — must happen before reconciliation) */}
        <SupplierValidationModal
          open={state.releveSupplierModalOpen}
          onOpenChange={state.handleReleveSupplierOnOpenChange}
          extractedSupplierName={state.releveExtractedSupplierName}
          onSupplierValidated={state.handleReleveSupplierValidated}
          onCancel={state.handleReleveSupplierCancel}
        />

        {/* Relevé Reconciliation Modal */}
        <ReleveReconciliationModal
          open={state.releveModalOpen}
          onOpenChange={state.setReleveModalOpen}
          releveResponse={state.documentHook.releveResponse}
          reconciliation={state.releveHook.reconciliation}
          guardrails={state.releveHook.guardrails}
          isReconciling={state.releveHook.isReconciling}
          onValidated={state.handleReleveValidated}
          onCancel={state.handleReleveCancel}
        />
      </div>
    </ResponsiveLayout>
  );
}
