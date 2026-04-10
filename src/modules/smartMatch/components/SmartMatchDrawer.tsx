/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART_MATCH — SmartMatchDrawer (UI composant unique)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Drawer/Sheet partagé par Factures, BL, Achat.
 * Affiche les candidats SmartMatch triés par confidence.
 * 
 * RÈGLES:
 * - Aucun auto-select sauf confidence=1 exact
 * - Apprentissage via smartMatchLearn() après validation humaine
 * - Feature flag: SMART_MATCH_ENABLED
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { normalizeSearch } from "@/utils/normalizeSearch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Loader2, Zap, Search, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { smartMatch, smartMatchLearn } from "../index";
import type { SmartMatchRequest, SmartMatchResponse, SmartMatchCandidate, MatchReason } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SmartMatchDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** SmartMatch request params */
  request: SmartMatchRequest | null;
  /** Called when user selects a product */
  onSelectProduct: (productId: string, productName: string) => void;
  /** Optional: callback to create a new product instead */
  onCreateNew?: () => void;
  /** Disable interactions */
  disabled?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// REASON LABELS
// ═══════════════════════════════════════════════════════════════════════════

const REASON_LABELS: Record<MatchReason, { label: string; variant: "default" | "secondary" | "outline" }> = {
  code_barres: { label: "Code-barres", variant: "default" },
  code_produit: { label: "Code exact", variant: "default" },
  alias: { label: "Alias", variant: "default" },
  name_exact: { label: "Nom exact", variant: "default" },
  fuzzy: { label: "Fuzzy", variant: "secondary" },
  unit_boost: { label: "Unité ✓", variant: "outline" },
  category_boost: { label: "Catégorie ✓", variant: "outline" },
  brain_boost: { label: "Brain ✓", variant: "outline" },
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function SmartMatchDrawer({
  open,
  onOpenChange,
  request,
  onSelectProduct,
  onCreateNew,
  disabled = false,
}: SmartMatchDrawerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<SmartMatchResponse | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  // Fetch SmartMatch results when opened
  useEffect(() => {
    if (!open || !request) {
      setResponse(null);
      setSearchFilter("");
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    smartMatch(request)
      .then((res) => {
        if (!cancelled) setResponse(res);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[SmartMatch] error:", err);
          setResponse({ bestMatch: null, candidates: [], autoSelectRecommended: false });
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, request]);

  // Filter candidates by search
  const filteredCandidates = useMemo(() => {
    if (!response?.candidates) return [];
    if (!searchFilter.trim()) return response.candidates;
    const q = normalizeSearch(searchFilter);
    return response.candidates.filter(
      (c) =>
        normalizeSearch(c.nom_produit).includes(q) ||
        (c.code_produit ? normalizeSearch(c.code_produit).includes(q) : false)
    );
  }, [response, searchFilter]);

  // Handle selection
  const handleSelect = useCallback(
    async (candidate: SmartMatchCandidate) => {
      if (!request) return;

      onSelectProduct(candidate.product_id, candidate.nom_produit);

      // Fire-and-forget learning
      smartMatchLearn({
        establishment_id: request.establishment_id,
        supplier_id: request.supplier_id,
        raw_label: request.raw_label,
        code_produit: request.code_produit,
        confirmed_product_id: candidate.product_id,
        action: candidate.confidence >= 1 ? "confirmed" : "corrected",
      }).catch(() => { /* silent */ });

      onOpenChange(false);
      toast.success(`Produit associé : ${candidate.nom_produit}`);
    },
    [request, onSelectProduct, onOpenChange]
  );

  const hasUnmatchedCode = !!request?.code_produit?.trim() &&
    response?.candidates.every((c) => c.reasons[0] !== "code_produit" && c.reasons[0] !== "code_barres");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col overflow-hidden">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            SmartMatch
          </SheetTitle>
          {request && (
            <div className="mt-2 p-3 bg-muted/50 rounded-lg border">
              <p className="text-xs text-muted-foreground">Produit recherché :</p>
              <p className="font-semibold text-sm">{request.raw_label}</p>
              {request.code_produit && (
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  Code : {request.code_produit}
                </p>
              )}
            </div>
          )}
          <SheetDescription>
            Sélectionnez le produit correspondant dans votre catalogue.
          </SheetDescription>
        </SheetHeader>

        {/* Code inconnu banner */}
        {hasUnmatchedCode && !isLoading && (
          <div className="flex items-center gap-2 px-3 py-2 mx-1 mt-2 rounded-lg bg-warning/10 border border-warning/30">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
            <p className="text-xs text-warning">
              Code inconnu — suggestions basées sur le nom. Validation humaine requise.
            </p>
          </div>
        )}

        {/* Search filter */}
        {!isLoading && (response?.candidates.length ?? 0) > 3 && (
          <div className="relative mt-3 mx-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filtrer les résultats..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-9"
            />
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Recherche en cours…</p>
            </div>
          </div>
        )}

        {/* No results */}
        {!isLoading && filteredCandidates.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <p className="text-sm">Aucun candidat trouvé</p>
              {onCreateNew && (
                <Button onClick={onCreateNew} disabled={disabled} size="sm">
                  Créer un nouveau produit
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Candidates list */}
        {!isLoading && filteredCandidates.length > 0 && (
          <>
            <ScrollArea className="flex-1 min-h-0 mt-3">
              <div className="space-y-2 pr-4">
                {filteredCandidates.map((candidate, i) => (
                  <CandidateCard
                    key={candidate.product_id}
                    candidate={candidate}
                    isFirst={i === 0}
                    onSelect={() => handleSelect(candidate)}
                    disabled={disabled}
                  />
                ))}
              </div>
            </ScrollArea>

            {onCreateNew && (
              <div className="pt-3 border-t mt-2">
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    onCreateNew();
                    onOpenChange(false);
                  }}
                  disabled={disabled}
                >
                  Créer un nouveau produit
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CANDIDATE CARD
// ═══════════════════════════════════════════════════════════════════════════

function CandidateCard({
  candidate,
  isFirst,
  onSelect,
  disabled,
}: {
  candidate: SmartMatchCandidate;
  isFirst: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  const confidencePercent = Math.round(candidate.confidence * 100);
  const isExact = candidate.confidence >= 1;
  const primaryReason = candidate.reasons[0];

  return (
    <div
      className={`p-3 rounded-lg border transition-colors hover:bg-accent/50 ${
        isFirst && isExact
          ? "border-2 border-primary/40 bg-primary/5"
          : isFirst
            ? "border-primary/20 bg-primary/5"
            : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm truncate uppercase">{candidate.nom_produit}</p>
            {isExact && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {candidate.code_produit && (
              <span className="text-xs text-muted-foreground font-mono">
                {candidate.code_produit}
              </span>
            )}
            {candidate.category && (
              <span className="text-xs text-muted-foreground">· {candidate.category}</span>
            )}
            {candidate.conditionnement_resume && (
              <span className="text-xs text-muted-foreground">
                · {candidate.conditionnement_resume}
              </span>
            )}
          </div>

          {/* Reasons + confidence */}
          <div className="flex flex-wrap items-center gap-1 mt-2">
            {candidate.reasons.map((reason) => {
              const cfg = REASON_LABELS[reason];
              return (
                <Badge
                  key={reason}
                  variant={cfg.variant}
                  className="text-[10px] px-1.5 py-0"
                >
                  {cfg.label}
                </Badge>
              );
            })}
            <span
              className={`text-[10px] font-mono ml-auto ${
                confidencePercent >= 90
                  ? "text-primary"
                  : confidencePercent >= 60
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-muted-foreground"
              }`}
            >
              {confidencePercent}%
            </span>
          </div>
        </div>

        <Button
          size="sm"
          variant={isFirst ? "default" : "outline"}
          onClick={onSelect}
          disabled={disabled}
          className="shrink-0 mt-1"
        >
          Sélectionner
        </Button>
      </div>
    </div>
  );
}
