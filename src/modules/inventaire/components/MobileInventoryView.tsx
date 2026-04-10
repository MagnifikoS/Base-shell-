/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE V0/V1 — Mobile View (Dual Mode: COMPTAGE / CORRECTION + V1 modules)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 3: Results edit via UniversalQuantityModal (no more prompt fallback).
 */

import { useState, useEffect, Component, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { InventoryTypeSelector, type InventoryType } from "../components/InventoryTypeSelector";
import { ZoneSelector } from "../components/ZoneSelector";
import { ZoneActionDialog } from "../components/ZoneActionDialog";
import { CountingModal, type CountingModalMode } from "../components/CountingModal";
import { InventoryResultList } from "../components/InventoryResultList";
import { useInventorySessions } from "../hooks/useInventorySessions";
import { useInventoryLines } from "../hooks/useInventoryLines";
import { useUnitConversions } from "@/core/unitConversion";
import { useProductInputConfigs } from "@/modules/inputConfig";
import { QuantityModalWithResolver } from "@/components/stock/QuantityModalWithResolver";
import { type QuantityProduct } from "@/components/stock/UniversalQuantityModal";
import { useProductCurrentStock } from "@/hooks/useProductCurrentStock";
import type { ZoneWithInventoryStatus, InventoryLineWithProduct } from "../types";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Pencil, RotateCcw, AlertTriangle } from "lucide-react";

/** Error boundary to isolate CountingModal crashes */
class CountingModalBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-background/80">
          <div className="bg-card p-6 rounded-xl shadow-lg space-y-4 max-w-sm text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
            <p className="text-sm font-medium">Une erreur est survenue dans le comptage.</p>
            <p className="text-xs text-muted-foreground">Votre session est préservée.</p>
            <Button
              onClick={() => {
                this.setState({ hasError: false });
                this.props.onReset();
              }}
            >
              Réessayer
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// V1 mobile views
import { MobileReceptionView, WithdrawalTabWrapper } from "@/modules/stockLedger";
import { MobileStockAlertsView } from "@/modules/stockAlerts";
import { MobileStockListView } from "./MobileStockListView";

import { BlAppPostPopup } from "@/modules/blApp";

// ─── Helper: map inventory line to QuantityProduct ────────────────────────
function lineToQuantityProduct(line: InventoryLineWithProduct): QuantityProduct {
  return {
    id: line.product_id,
    nom_produit: line.product_name,
    stock_handling_unit_id: line.product_stock_handling_unit_id,
    final_unit_id: line.product_final_unit_id,
    delivery_unit_id: line.product_delivery_unit_id,
    supplier_billing_unit_id: line.product_supplier_billing_unit_id,
    conditionnement_config: line.product_conditionnement_config as unknown as Record<string, unknown> | null,
  };
}

export function MobileInventoryView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as InventoryType | null;

  const [selectedType, setSelectedType] = useState<InventoryType | null>(tabParam ?? null);
  const [selectedZone, setSelectedZone] = useState<ZoneWithInventoryStatus | null>(null);

  // Clear the ?tab param once consumed so back nav works naturally
  useEffect(() => {
    if (tabParam) {
      searchParams.delete("tab");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [showCounting, setShowCounting] = useState(false);
  const [countingMode, setCountingMode] = useState<CountingModalMode>("comptage");
  const [viewResultsSessionId, setViewResultsSessionId] = useState<string | null>(null);
  const [showCompletionScreen, setShowCompletionScreen] = useState(false);

  // Phase 3: popup state for editing inventory results
  const [editingLine, setEditingLine] = useState<InventoryLineWithProduct | null>(null);
  const mobileInventoryStock = useProductCurrentStock(editingLine?.product_id);

  const { sessions, zonesWithStatus, startSession, pauseSession, completeSession, restartSession } =
    useInventorySessions();

  const {
    lines,
    isLoading: linesLoading,
    totalCount,
    countedCount,
    count,
    updateQuantity,
  } = useInventoryLines(activeSessionId || viewResultsSessionId);

  const { units: dbUnits, conversions: dbConversions } = useUnitConversions();
  const inputConfigs = useProductInputConfigs();

  // ═══════════════════════════════════════════════════════════════════════
  // ZONE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════

  const handleStart = async (zoneId: string) => {
    setSelectedZone(null);
    const result = await startSession.mutateAsync(zoneId);
    setActiveSessionId(result.session.id);
    setActiveZoneId(zoneId);
    setCountingMode("comptage");
    setShowCounting(true);
    setShowCompletionScreen(false);
  };

  const handleResume = (sessionId: string) => {
    setSelectedZone(null);
    const session = sessions.find((s) => s.id === sessionId);
    setActiveZoneId(session?.storage_zone_id ?? null);
    setActiveSessionId(sessionId);
    setCountingMode("comptage");
    setShowCounting(true);
    setShowCompletionScreen(false);
  };

  const handleRestart = async (sessionId: string, zoneId: string) => {
    setSelectedZone(null);
    const result = await restartSession.mutateAsync({ sessionId, zoneId });
    setActiveSessionId(result.session.id);
    setActiveZoneId(zoneId);
    setCountingMode("comptage");
    setShowCounting(true);
    setShowCompletionScreen(false);
  };

  const handleViewResults = (zoneId: string) => {
    setSelectedZone(null);
    const completedSession = sessions.find(
      (s) => s.storage_zone_id === zoneId && s.status === "termine"
    );
    if (completedSession) {
      setViewResultsSessionId(completedSession.id);
    }
  };

  const _handlePause = async () => {
    if (activeSessionId) {
      await pauseSession.mutateAsync(activeSessionId);
    }
    setShowCounting(false);
    setActiveSessionId(null);
    setActiveZoneId(null);
    setShowCompletionScreen(false);
  };

  const handleComplete = async (sessionId?: string) => {
    const sid = sessionId || activeSessionId;
    if (sid) {
      await completeSession.mutateAsync(sid);
    }
    setShowCounting(false);
    setActiveSessionId(null);
    setActiveZoneId(null);
    setSelectedZone(null);
    setShowCompletionScreen(false);
  };

  // COUNT mutation (for COMPTAGE mode — sets counted_at)
  const handleCount = async (
    lineId: string,
    quantity: number,
    unitId: string | null
  ): Promise<void> => {
    await count.mutateAsync({ lineId, quantity, unitId });
  };

  // UPDATE mutation (for CORRECTION mode — does NOT touch counted_at)
  const handleUpdateLine = async (
    lineId: string,
    quantity: number,
    unitId: string | null
  ): Promise<void> => {
    await updateQuantity.mutateAsync({ lineId, quantity, unitId });
  };

  const handleAllCounted = () => {
    setShowCounting(false);
    setShowCompletionScreen(true);
  };

  const handleOpenCorrection = () => {
    setShowCompletionScreen(false);
    setCountingMode("correction");
    setShowCounting(true);
  };

  const _handleBackToComptage = () => {
    setCountingMode("comptage");
    const hasUncounted = lines.some((l) => l.counted_at === null);
    if (!hasUncounted) {
      setShowCounting(false);
      setShowCompletionScreen(true);
    }
  };

  const _isAllCounted = totalCount > 0 && countedCount === totalCount;
  const activeZoneName = zonesWithStatus.find((z) => z.id === activeZoneId)?.name ?? "Zone";

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 3: Handle edit via UniversalQuantityModal
  // ═══════════════════════════════════════════════════════════════════════

  const handleEditLineViaPopup = (lineId: string) => {
    const line = lines.find((l) => l.id === lineId);
    if (!line) return;
    setEditingLine(line);
  };

  const handlePopupConfirm = async (params: {
    productId: string;
    canonicalQuantity: number;
    canonicalUnitId: string;
  }) => {
    if (!editingLine) return;
    await handleUpdateLine(editingLine.id, params.canonicalQuantity, params.canonicalUnitId);
  };

  // ═══════════════════════════════════════════════════════════════════════
  // V1 MODULE ROUTING
  // ═══════════════════════════════════════════════════════════════════════

  if (selectedType === "stock") {
    return <MobileStockListView onBack={() => setSelectedType(null)} />;
  }
  if (selectedType === "reception") {
    return <MobileReceptionView onBack={() => setSelectedType(null)} PostPopup={BlAppPostPopup} />;
  }
  if (selectedType === "retrait") {
    return <WithdrawalTabWrapper onBack={() => setSelectedType(null)} />;
  }
  if (selectedType === "alertes") {
    return <MobileStockAlertsView onBack={() => setSelectedType(null)} />;
  }

  return (
    <div className="py-4 px-4 space-y-5">
      {/* Step 1: Type selection */}
      {!selectedType && !showCompletionScreen && (
        <InventoryTypeSelector onSelect={setSelectedType} />
      )}

      {/* Step 2: Zone selection (only for "produit") */}
      {selectedType === "produit" && !showCompletionScreen && (
        <>
          <ZoneSelector
            zones={zonesWithStatus}
            onSelectZone={setSelectedZone}
            onBack={() => {
              setSelectedType(null);
              setViewResultsSessionId(null);
            }}
          />

          {/* Result view (when viewing completed session) */}
          {viewResultsSessionId && lines.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Résultats</h2>
                <button
                  className="text-sm text-muted-foreground underline"
                  onClick={() => setViewResultsSessionId(null)}
                >
                  Fermer
                </button>
              </div>
              <InventoryResultList
                lines={lines}
                dbUnits={dbUnits}
                editable={true}
                onEditLine={handleEditLineViaPopup}
              />
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* COMPLETION SCREEN — All products counted                       */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {showCompletionScreen && activeSessionId && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6 px-4">
          <div className="flex flex-col items-center space-y-3">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-center">Inventaire terminé</h2>
            <p className="text-sm text-muted-foreground text-center">
              {activeZoneName} — {countedCount}/{totalCount} produits comptés
            </p>
          </div>

          <div className="w-full max-w-sm space-y-3">
            <Button
              onClick={() => handleComplete()}
              className="w-full h-12 text-base font-semibold"
              disabled={completeSession.isPending}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Terminer l'inventaire
            </Button>

            <Button variant="outline" onClick={handleOpenCorrection} className="w-full">
              <Pencil className="h-4 w-4 mr-2" />
              Corriger des quantités
            </Button>

            <Button
              variant="ghost"
              onClick={() => {
                if (activeSessionId && activeZoneId) {
                  handleRestart(activeSessionId, activeZoneId);
                }
              }}
              disabled={!activeZoneId}
              className="w-full text-muted-foreground"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Recommencer à zéro
            </Button>

            <Button
              variant="ghost"
              onClick={() => {
                setShowCompletionScreen(false);
                setActiveSessionId(null);
                setActiveZoneId(null);
              }}
              className="w-full text-muted-foreground text-sm"
            >
              Retour aux zones
            </Button>
          </div>
        </div>
      )}

      {/* Zone action dialog */}
      <ZoneActionDialog
        zone={selectedZone}
        onClose={() => setSelectedZone(null)}
        onStart={handleStart}
        onResume={handleResume}
        onRestart={handleRestart}
        onViewResults={handleViewResults}
        onComplete={handleComplete}
      />

      {/* Counting modal (COMPTAGE or CORRECTION) — wrapped in error boundary */}
      <CountingModalBoundary onReset={() => setShowCounting(false)}>
        <CountingModal
          open={showCounting}
          onClose={() => {
            if (countingMode === "correction") {
              const hasUncounted = lines.some((l) => l.counted_at === null);
              if (!hasUncounted && activeSessionId) {
                setShowCounting(false);
                setShowCompletionScreen(true);
                return;
              }
            }
            setShowCounting(false);
            setActiveSessionId(null);
            setActiveZoneId(null);
          }}
          lines={lines}
          linesLoading={linesLoading}
          dbUnits={dbUnits}
          dbConversions={dbConversions}
          zoneName={activeZoneName}
          mode={countingMode}
          inputConfigs={inputConfigs}
          onCount={handleCount}
          onUpdate={handleUpdateLine}
          onAllCounted={handleAllCounted}
        />
      </CountingModalBoundary>

      {/* Phase 3: Universal popup for editing inventory results */}
      <QuantityModalWithResolver
        open={!!editingLine}
        onClose={() => setEditingLine(null)}
        product={editingLine ? lineToQuantityProduct(editingLine) : null}
        dbUnits={dbUnits}
        dbConversions={dbConversions}
        existingQuantity={editingLine?.quantity}
        contextLabel="Inventaire"
        contextType="inventory"
        currentStockCanonical={mobileInventoryStock.currentStockCanonical}
        currentStockUnitLabel={mobileInventoryStock.currentStockUnitLabel}
        currentStockLoading={mobileInventoryStock.isLoading}
        onConfirm={handlePopupConfirm}
      />
    </div>
  );
}
