/**
 * Agent Produit — Upload + WizardOptions + Appel IA (Phase 1).
 * Deux vues : liste des factures analysées, puis tableau plein écran au clic.
 * Aucune persistance backend, aucune logique métier ajoutée.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Play, Loader2, AlertCircle, FileText, X, CheckCircle2, PenLine, ArrowLeft, Info } from "lucide-react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { ProductTable } from "./ProductTable";
import { Button } from "@/components/ui/button";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { getWizardOptions } from "@/modules/produitsV2/pipeline/getWizardOptions";
import type { WizardOptions } from "@/modules/produitsV2/pipeline/getWizardOptions";
import { computeSupplierMatch } from "@/modules/fournisseurs/utils/supplierMatcher";
import { getSupplierById, updateSupplier, type Supplier } from "@/modules/fournisseurs/services/supplierService";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";

const COMPARED_FIELDS = [
  "nom", "fournisseur", "categorie", "zone_stockage",
  "unite_finale_abbr", "unite_facturation_abbr",
  "prix_unitaire_ht", "prix_ligne_ht", "vente_unite", "fractionne",
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fieldEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a === "object" && typeof b === "object") {
    return (a.id ?? a.abbreviation) === (b.id ?? b.abbreviation);
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countModifiedProducts(original: any[], edited: any[]): number {
  let count = 0;
  for (let i = 0; i < original.length && i < edited.length; i++) {
    const o = original[i];
    const e = edited[i];
    const fieldDiff = COMPARED_FIELDS.some((f) => !fieldEqual(o[f], e[f]));
    const condLenDiff =
      (o.niveaux_conditionnement?.length ?? 0) !== (e.niveaux_conditionnement?.length ?? 0);
    if (fieldDiff || condLenDiff) count++;
  }
  return count;
}

/** Full invoice data stored per entry */
interface StoredInvoice {
  id: string;
  label: string;
  fileName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analysisResult: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editableProducts: any[];
  totalProduits: number;
  timestamp: number;
  supplierMatch?: {
    id: string;
    name: string;
    similarity: number;
    type: string;
  } | null;
  supplierInfo?: {
    nom: string | null;
    siret: string | null;
    vat_number: string | null;
    billing_address: string | null;
    postal_code: string | null;
    city: string | null;
    country: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    iban: string | null;
  } | null;
}

const ENRICHABLE_FIELDS = [
  "siret",
  "vat_number",
  "billing_address",
  "postal_code",
  "city",
  "country",
  "contact_email",
  "contact_phone",
] as const;

function computeEnrichmentPatch(
  dbSupplier: Supplier | null,
  supplierInfo: StoredInvoice["supplierInfo"] | undefined
): Record<string, string> {
  if (!dbSupplier || !supplierInfo) return {};

  const patch: Record<string, string> = {};
  for (const field of ENRICHABLE_FIELDS) {
    const dbValue = dbSupplier[field];
    const extractedValue = supplierInfo[field];
    if (!dbValue && extractedValue) {
      patch[field] = extractedValue;
    }
  }

  return patch;
}

/**
 * Map raw AI response products (string fields) to typed objects expected by ProductTable.
 * The edge function returns fournisseur/categorie/zone_stockage as name strings
 * and unite_finale_abbr/unite_facturation_abbr/contient_unite_abbr as abbreviation strings.
 * We resolve them to { id, name } or { id, abbreviation } objects using wizardOpts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRawProductsToTyped(rawProducts: any[], opts: WizardOptions): any[] {
  return rawProducts.map((p) => {
    const mapped = { ...p };

    // fournisseur: string → { id, name } | null
    if (typeof mapped.fournisseur === "string") {
      const match = opts.suppliers.find((s) => s.name === mapped.fournisseur);
      mapped.fournisseur = match ? { id: match.id, name: match.name } : null;
    }

    // categorie: string → { id, name } | null
    if (typeof mapped.categorie === "string") {
      const match = opts.categories.find((c) => c.name === mapped.categorie);
      mapped.categorie = match ? { id: match.id, name: match.name } : null;
    }

    // zone_stockage: string → { id, name } | null
    if (typeof mapped.zone_stockage === "string") {
      const match = opts.storageZones.find((z) => z.name === mapped.zone_stockage);
      mapped.zone_stockage = match ? { id: match.id, name: match.name } : null;
    }

    // unite_finale_abbr: string → { id, abbreviation } | null
    if (typeof mapped.unite_finale_abbr === "string") {
      const match = opts.units.find((u) => u.abbreviation === mapped.unite_finale_abbr);
      mapped.unite_finale_abbr = match ? { id: match.id, abbreviation: match.abbreviation } : null;
    }

    // unite_facturation_abbr: string → { id, abbreviation } | null
    if (typeof mapped.unite_facturation_abbr === "string") {
      const match = opts.units.find((u) => u.abbreviation === mapped.unite_facturation_abbr);
      mapped.unite_facturation_abbr = match ? { id: match.id, abbreviation: match.abbreviation } : null;
    }

    // niveaux_conditionnement[].contient_unite_abbr: string → { id, abbreviation } | null
    if (Array.isArray(mapped.niveaux_conditionnement)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mapped.niveaux_conditionnement = mapped.niveaux_conditionnement.map((n: any) => {
        if (typeof n.contient_unite_abbr === "string") {
          const match = opts.units.find((u) => u.abbreviation === n.contient_unite_abbr);
          return { ...n, contient_unite_abbr: match ? { id: match.id, abbreviation: match.abbreviation } : null };
        }
        return n;
      });
    }

    return mapped;
  });
}

const ACCEPTED_TYPES = ".pdf,.jpg,.jpeg,.png";
const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const STORAGE_KEY_PREFIX = "agent_ia_invoices_";

function loadStoredInvoices(estId: string): StoredInvoice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + estId);
    if (!raw) return [];
    return JSON.parse(raw) as StoredInvoice[];
  } catch {
    return [];
  }
}

function saveStoredInvoices(estId: string, invoices: StoredInvoice[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + estId, JSON.stringify(invoices));
  } catch {
    // localStorage full — silently fail
  }
}

export function AgentProduitPage() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;

  // File state — multiple files
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // WizardOptions state
  const [wizardOpts, setWizardOpts] = useState<WizardOptions | null>(null);
  const [optsLoading, setOptsLoading] = useState(false);
  const [optsError, setOptsError] = useState<string | null>(null);

  // Batch analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, fileName: "" });
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [analyzeStartTime, setAnalyzeStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Rotating progress messages
  useEffect(() => {
    if (!analyzeStartTime) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - analyzeStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [analyzeStartTime]);

  const progressMessage = useMemo(() => {
    if (elapsedSeconds < 3) return "Claude lit la facture...";
    if (elapsedSeconds < 8) return "Identification des produits...";
    if (elapsedSeconds < 15) return "Extraction en cours...";
    return "Finalisation du JSON...";
  }, [elapsedSeconds]);

  // Multi-invoice list — initialized from localStorage
  const [invoices, setInvoices] = useState<StoredInvoice[]>(() =>
    establishmentId ? loadStoredInvoices(establishmentId) : [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const supplierCacheRef = useRef<Map<string, Supplier>>(new Map());
  const [currentSupplierData, setCurrentSupplierData] = useState<Supplier | null>(null);

  // Reload invoices when establishment changes
  useEffect(() => {
    if (establishmentId) {
      const stored = loadStoredInvoices(establishmentId);
      setInvoices(stored);
      setSelectedId(null);
    } else {
      setInvoices([]);
      setSelectedId(null);
    }
  }, [establishmentId]);

  // Persist invoices to localStorage on change
  useEffect(() => {
    if (establishmentId) {
      saveStoredInvoices(establishmentId, invoices);
    }
  }, [invoices, establishmentId]);

  // Derived: currently selected invoice
  const selectedInvoice = useMemo(
    () => invoices.find((inv) => inv.id === selectedId) ?? null,
    [invoices, selectedId],
  );
  const enrichmentPatch = useMemo(
    () => computeEnrichmentPatch(currentSupplierData, selectedInvoice?.supplierInfo),
    [currentSupplierData, selectedInvoice?.supplierInfo],
  );

  // Update editable products for the selected invoice
  const handleUpdateProduct = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (index: number, updatedProduct: any) => {
      setInvoices((prev) =>
        prev.map((inv) => {
          if (inv.id !== selectedId) return inv;
          const updated = [...inv.editableProducts];
          updated[index] = { ...updatedProduct };
          return { ...inv, editableProducts: updated };
        }),
      );
    },
    [selectedId],
  );

  // Modified count for selected invoice
  const modifiedCount = useMemo(() => {
    if (!selectedInvoice) return 0;
    return countModifiedProducts(selectedInvoice.analysisResult.produits, selectedInvoice.editableProducts);
  }, [selectedInvoice]);

  // Fetch wizard options on mount / establishment change
  useEffect(() => {
    if (!establishmentId) {
      setWizardOpts(null);
      setOptsError(null);
      return;
    }

    let cancelled = false;
    setOptsLoading(true);
    setOptsError(null);

    getWizardOptions(establishmentId)
      .then((opts) => {
        if (!cancelled) setWizardOpts(opts);
      })
      .catch((err) => {
        if (!cancelled)
          setOptsError(err instanceof Error ? err.message : "Erreur lors du chargement des options");
      })
      .finally(() => {
        if (!cancelled) setOptsLoading(false);
      });

    return () => { cancelled = true; };
  }, [establishmentId]);

  useEffect(() => {
    let cancelled = false;
    const supplierId = selectedInvoice?.supplierMatch?.id ?? null;

    if (!supplierId) {
      setCurrentSupplierData(null);
      return;
    }

    const cached = supplierCacheRef.current.get(supplierId);
    if (cached) {
      setCurrentSupplierData(cached);
      return;
    }

    (async () => {
      const result = await getSupplierById(supplierId);
      if (cancelled) return;
      if (result.success && result.data) {
        supplierCacheRef.current.set(supplierId, result.data);
        setCurrentSupplierData(result.data);
      } else {
        setCurrentSupplierData(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedInvoice?.supplierMatch?.id]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const validFiles = Array.from(fileList).filter((f) => ACCEPTED_MIME.includes(f.type));
    if (validFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...validFiles]);
    }
    e.target.value = "";
  };

  const handleRemoveFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearFiles = () => {
    setPendingFiles([]);
    setBatchErrors([]);
  };

  const handleAnalyze = async () => {
    if (pendingFiles.length === 0 || !wizardOpts) return;

    const filesToProcess = [...pendingFiles];
    setPendingFiles([]);
    setAnalyzing(true);
    setAnalyzeStartTime(Date.now());
    setBatchErrors([]);
    setBatchProgress({ current: 0, total: filesToProcess.length, fileName: "" });

    let lastId: string | null = null;

    for (let i = 0; i < filesToProcess.length; i++) {
      const currentFile = filesToProcess[i];
      setBatchProgress({ current: i + 1, total: filesToProcess.length, fileName: currentFile.name });

      try {
        const base64 = await fileToBase64(currentFile);

        const { data, error } = await supabase.functions.invoke("agent-ia-extract", {
          body: {
            file_base64: base64,
            file_type: currentFile.type,
            wizard_options: wizardOpts,
          },
        });

        if (error) {
          setBatchErrors((prev) => [...prev, `${currentFile.name} : erreur réseau`]);
          continue;
        }

        if (data?.error) {
          const msg = data.error === "PARSE_ERROR"
            ? "format invalide"
            : data.error;
          setBatchErrors((prev) => [...prev, `${currentFile.name} : ${msg}`]);
          continue;
        }

        // Build invoice entry and add to list
        const id = crypto.randomUUID();
        const label = data.numero_facture || data.numero_bl || currentFile.name;
        const suppliersForMatch = wizardOpts.suppliers.map((s) => ({
          ...s,
          name_normalized: null as string | null,
        }));
        const supplierInfo = data?.fournisseur_info
          ? {
              nom: data.fournisseur_info.nom ?? null,
              siret: data.fournisseur_info.siret ?? null,
              vat_number: data.fournisseur_info.vat_number ?? null,
              billing_address: data.fournisseur_info.billing_address ?? null,
              postal_code: data.fournisseur_info.postal_code ?? null,
              city: data.fournisseur_info.city ?? null,
              country: data.fournisseur_info.country ?? null,
              contact_email: data.fournisseur_info.contact_email ?? null,
              contact_phone: data.fournisseur_info.contact_phone ?? null,
              iban: data.fournisseur_info.iban ?? null,
            }
          : null;
        const extractedName =
          supplierInfo?.nom ??
          data.fournisseur_detecte ??
          null;
        const matchResult = extractedName
          ? computeSupplierMatch(extractedName, suppliersForMatch)
          : null;
        const supplierMatch =
          matchResult && matchResult.similarity >= 0.7 && matchResult.supplierId && matchResult.supplierName
            ? {
                id: matchResult.supplierId,
                name: matchResult.supplierName,
                similarity: matchResult.similarity,
                type: matchResult.type,
              }
            : null;
        // DEBUG TEMPORAIRE: diagnostic matching fournisseur
        // eslint-disable-next-line no-console
        console.log("[AgentIA] fournisseur_detecte:", data.fournisseur_detecte);
        // eslint-disable-next-line no-console
        console.log("[AgentIA] fournisseur_info:", data.fournisseur_info);
        // eslint-disable-next-line no-console
        console.log("[AgentIA] extractedName:", extractedName);
        // eslint-disable-next-line no-console
        console.log("[AgentIA] matchResult:", matchResult);
        // eslint-disable-next-line no-console
        console.log("[AgentIA] supplierMatch final:", supplierMatch);
        const entry: StoredInvoice = {
          id,
          label,
          fileName: currentFile.name,
          analysisResult: data,
          editableProducts: mapRawProductsToTyped(structuredClone(data.produits ?? []), wizardOpts),
          totalProduits: data.total_produits ?? 0,
          timestamp: Date.now(),
          supplierMatch,
          supplierInfo,
        };

        setInvoices((prev) => [...prev, entry]);
        lastId = id;
      } catch {
        setBatchErrors((prev) => [...prev, `${currentFile.name} : erreur inattendue`]);
      }
    }

    setAnalyzing(false);
    setAnalyzeStartTime(null);
    // Auto-open last analyzed if only one
    if (filesToProcess.length === 1 && lastId) {
      setSelectedId(lastId);
    }
  };

  const handleEnrichSupplier = useCallback(async () => {
    if (!selectedInvoice?.supplierMatch?.id) return;
    if (Object.keys(enrichmentPatch).length === 0) return;

    try {
      const result = await updateSupplier(selectedInvoice.supplierMatch.id, enrichmentPatch);
      if (!result.success) {
        throw new Error(result.error || "UPDATE_FAILED");
      }
      supplierCacheRef.current.delete(selectedInvoice.supplierMatch.id);
      setCurrentSupplierData(null);
      const refreshed = await getSupplierById(selectedInvoice.supplierMatch.id);
      if (refreshed.success && refreshed.data) {
        supplierCacheRef.current.set(selectedInvoice.supplierMatch.id, refreshed.data);
        setCurrentSupplierData(refreshed.data);
      }
      toast({ title: "Fiche fournisseur complétée" });
    } catch {
      toast({
        title: "Erreur",
        description: "Impossible de compléter la fiche",
        variant: "destructive",
      });
    }
  }, [enrichmentPatch, selectedInvoice]);

  const canAnalyze = pendingFiles.length > 0 && wizardOpts !== null && !analyzing;

  // No establishment selected
  if (!establishmentId) {
    return (
      <ResponsiveLayout>
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold">Agent Produit</h1>
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span>Aucun établissement sélectionné</span>
        </div>
      </div>
      </ResponsiveLayout>
    );
  }

  // ─── VUE DÉTAIL : tableau plein écran ───
  if (selectedInvoice) {
    return (
      <ResponsiveLayout>
        <div className="p-4 space-y-4 overflow-auto">
          {/* Header with back button */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedId(null)}
              className="shrink-0"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Retour
            </Button>
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">
                {selectedInvoice.totalProduits} produits — {selectedInvoice.label}
              </span>
            </div>
            {modifiedCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <PenLine className="h-3.5 w-3.5" />
                <span>{modifiedCount} modifié{modifiedCount > 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
          {Object.keys(enrichmentPatch).length > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 shrink-0" />
                <span>
                  La facture contient {Object.keys(enrichmentPatch).length} information
                  {Object.keys(enrichmentPatch).length > 1 ? "s" : ""} manquante
                  {Object.keys(enrichmentPatch).length > 1 ? "s" : ""} sur ce fournisseur.
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={handleEnrichSupplier}>
                Compléter la fiche
              </Button>
            </div>
          )}

          {selectedInvoice.totalProduits === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>Aucun produit détecté dans ce document</span>
            </div>
          )}

          {selectedInvoice.editableProducts && wizardOpts && (
            <ProductTable
              produits={mapRawProductsToTyped(selectedInvoice.editableProducts, wizardOpts)}
              wizardOpts={wizardOpts}
              anomalieTotalTtc={selectedInvoice.analysisResult?.anomalie_total_ttc === true}
              onUpdateProduct={handleUpdateProduct}
            />
          )}
        </div>
      </ResponsiveLayout>
    );
  }

  // ─── VUE LISTE : import + factures analysées ───
  return (
    <ResponsiveLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agent Produit</h1>
        <p className="text-muted-foreground mt-1">
          Extraction intelligente de produits depuis vos factures fournisseurs.
        </p>
      </div>

      {/* WizardOptions loading / error */}
      {optsLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Chargement des données de l'établissement…</span>
        </div>
      )}
      {optsError && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{optsError}</span>
        </div>
      )}

      {/* Upload + Analyze */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <Button
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={analyzing}
        >
          <Paperclip className="h-4 w-4 mr-2" />
          Importer des factures
        </Button>

        <Button
          disabled={!canAnalyze}
          onClick={handleAnalyze}
        >
          {analyzing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Analyser {pendingFiles.length > 1 ? `(${pendingFiles.length})` : ""}
        </Button>

        {pendingFiles.length > 0 && !analyzing && (
          <Button variant="outline" size="sm" onClick={handleClearFiles}>
            <X className="h-3.5 w-3.5 mr-2" />
            Vider
          </Button>
        )}
      </div>

      {/* Pending files display */}
      {pendingFiles.length > 0 && !analyzing && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">
            {pendingFiles.length} fichier{pendingFiles.length > 1 ? "s" : ""} sélectionné{pendingFiles.length > 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-1.5 text-xs bg-muted/50 rounded px-2 py-1">
                <FileText className="h-3 w-3 text-muted-foreground" />
                <span className="max-w-[200px] truncate">{f.name}</span>
                <button
                  onClick={() => handleRemoveFile(i)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Retirer"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batch progress */}
      {analyzing && (
        <div className="space-y-2 max-w-md">
          <div className="flex items-center gap-3 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
            <div className="flex flex-col">
              <span className="font-medium">
                🤖 {progressMessage}
              </span>
              <span className="text-xs text-muted-foreground">
                Facture {batchProgress.current}/{batchProgress.total} — {batchProgress.fileName} ({elapsedSeconds}s)
              </span>
            </div>
          </div>
          <Progress
            value={batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}
            className="h-2"
          />
        </div>
      )}

      {/* Batch errors */}
      {batchErrors.length > 0 && !analyzing && (
        <div className="space-y-1 text-sm">
          <p className="text-destructive font-medium">
            {batchErrors.length} erreur{batchErrors.length > 1 ? "s" : ""} :
          </p>
          {batchErrors.map((err, i) => (
            <div key={i} className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      {/* Liste des factures analysées */}
      {invoices.length > 0 && !analyzing && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Factures analysées ({invoices.length})
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700"
              onClick={() => {
                if (!establishmentId) return;
                localStorage.removeItem(STORAGE_KEY_PREFIX + establishmentId);
                setInvoices([]);
                setSelectedId(null);
              }}
            >
              Vider l'historique
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {invoices.map((inv) => (
              <button
                key={inv.id}
                onClick={() => setSelectedId(inv.id)}
                className="flex items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/50 hover:border-primary/30"
              >
                <div className="rounded-md bg-primary/10 p-2 shrink-0">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{inv.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {inv.totalProduits} produit{inv.totalProduits > 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{inv.fileName}</p>
                </div>
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {invoices.length === 0 && pendingFiles.length === 0 && !analyzing && (
        <div className="text-sm text-muted-foreground mt-8">
          Importez vos factures pour commencer l'extraction.
        </div>
      )}
    </div>
    </ResponsiveLayout>
  );
}
