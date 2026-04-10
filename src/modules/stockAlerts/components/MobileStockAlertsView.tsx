/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOBILE STOCK ALERTS VIEW — Compact single-line-per-product list
 * ═══════════════════════════════════════════════════════════════════════════
 * Correction cas 4 — Volet B: refonte mobile ciblée
 * - 1 ligne par produit, scan visuel rapide
 * - Rupture = ligne rouge + icône X rouge
 * - Sous seuil = ligne blanche + warning jaune/orange
 * - Pas de mots "Rupture" / "Sous seuil"
 * - Pas de boutons "Créer BL APP" / "Voir produit"
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo } from "react";
import {
  ArrowLeft,
  AlertTriangle,
  XCircle,
  AlertOctagon,
  CheckCircle2,
  Filter,
  ArrowDownAZ,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useStockAlerts, type StockAlertItem, type AlertLevel } from "../hooks/useStockAlerts";
import { useAutoInitializeErrorProducts } from "../hooks/useAutoInitializeErrorProducts";
import { cn } from "@/lib/utils";
import { useStorageZones } from "@/modules/produitsV2";
import { useUnits } from "@/hooks/useUnits";
import { useUnitConversions } from "@/core/unitConversion";
import { resolveProductUnitContext, type ProductUnitContext } from "@/core/unitConversion";
import type { ConditioningConfig } from "@/modules/produitsV2";

type DisplayMode = "reference" | "supplier";

interface Props {
  onBack?: () => void;
  onNavigateReception?: () => void;
}

// ─── Conversion helpers ──────────────────────────────────────────────────

interface DisplayQuantity {
  value: number | null;
  label: string | null;
  error: boolean;
}

function convertToDisplay(
  canonicalQty: number | null,
  mode: DisplayMode,
  ctx: ProductUnitContext | null,
  deliveryUnitId?: string | null
): DisplayQuantity {
  if (canonicalQty == null || !ctx) return { value: null, label: null, error: false };

  if (mode === "reference") {
    // Mobile: show abbreviation only (extract from "Name (abbr)" format)
    const abbr = ctx.canonicalLabel?.match(/\(([^)]+)\)/)?.[1] ?? ctx.canonicalLabel;
    return { value: canonicalQty, label: abbr, error: false };
  }

  const allUnits = [...ctx.allowedInventoryEntryUnits, ...ctx.allowedPriceDisplayUnits];
  const supplierUnit =
    (deliveryUnitId ? allUnits.find((u) => u.id === deliveryUnitId) : null) ??
    ctx.allowedInventoryEntryUnits.find((u) => u.kind === "delivery" || u.kind === "packaging");
  if (!supplierUnit || supplierUnit.factorToTarget === 0) {
    return { value: null, label: null, error: true };
  }
  return {
    value: Math.round((canonicalQty / supplierUnit.factorToTarget) * 10000) / 10000,
    label: supplierUnit.abbreviation || supplierUnit.name,
    error: false,
  };
}

function formatQty(qty: number | null, label: string | null): string {
  if (qty == null) return "—";
  const rounded = Math.abs(qty) < 1 ? Math.round(qty * 1000) / 1000 : Math.round(qty * 100) / 100;
  return `${rounded} ${label ?? ""}`.trim();
}

// ─── Compact line component ─────────────────────────────────────────────

function AlertLine({
  item,
  displayMode,
  ctx,
}: {
  item: StockAlertItem;
  displayMode: DisplayMode;
  ctx: ProductUnitContext | null;
}) {
  const deliveryUnitId = item.product_unit_config?.delivery_unit_id ?? null;
  const stockD = convertToDisplay(item.estimated_quantity, displayMode, ctx, deliveryUnitId);
  const isRupture = item.alert_level === "rupture";
  const isWarning = item.alert_level === "warning";
  const isError = item.alert_level === "error";
  const isOk = item.alert_level === "ok";

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2.5 rounded-lg border",
        isRupture && "bg-destructive/8 border-destructive/40",
        isWarning && "bg-background border-border",
        isError && "bg-muted/30 border-border",
        isOk && "bg-background border-border opacity-70",
      )}
    >
      {/* Status icon */}
      <div className="shrink-0">
        {isRupture && <XCircle className="h-4 w-4 text-destructive" />}
        {isWarning && <AlertTriangle className="h-4 w-4 text-amber-500" />}
        {isError && <AlertOctagon className="h-4 w-4 text-muted-foreground" />}
        {isOk && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
      </div>

      {/* Product name */}
      <span
        className={cn(
          "flex-1 text-sm font-medium truncate min-w-0",
          isRupture && "text-destructive",
        )}
      >
        {item.product_name}
      </span>

      {/* Quantity + unit */}
      <span
        className={cn(
          "shrink-0 text-sm font-mono tabular-nums text-right",
          isRupture && "text-destructive font-semibold",
          isWarning && "text-amber-600 dark:text-amber-400 font-semibold",
          isError && "text-muted-foreground",
          isOk && "text-muted-foreground",
        )}
      >
        {isError
          ? "—"
          : stockD.error
            ? "—"
            : formatQty(stockD.value, stockD.label)}
      </span>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────

export function MobileStockAlertsView({ onBack }: Props) {
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [alertFilter, setAlertFilter] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("reference");
  const [showOk, setShowOk] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortMode, setSortMode] = useState<"alpha" | "supplier">("alpha");
  const { zones } = useStorageZones();
  const { units: dbUnits } = useUnits();
  const { conversions: dbConversions } = useUnitConversions();
  const {
    data: alerts,
    isLoading,
    isError: alertsError,
    refetch: refetchAlerts,
  } = useStockAlerts(zoneFilter);

  // ── Auto-initialize non-calculable products ────────────────────────
  useAutoInitializeErrorProducts({ alerts, isLoading, refetch: refetchAlerts });

  const productContexts = useMemo(() => {
    if (!alerts || !dbUnits.length) return new Map<string, ProductUnitContext>();
    const map = new Map<string, ProductUnitContext>();
    for (const item of alerts) {
      if (map.has(item.product_id) || !item.product_unit_config) continue;
      const cfg = item.product_unit_config;
      map.set(
        item.product_id,
        resolveProductUnitContext(
          {
            stock_handling_unit_id: cfg.stock_handling_unit_id,
            final_unit_id: cfg.final_unit_id,
            delivery_unit_id: cfg.delivery_unit_id,
            supplier_billing_unit_id: cfg.supplier_billing_unit_id,
            conditionnement_config: cfg.conditionnement_config as ConditioningConfig | null,
          },
          dbUnits,
          dbConversions
        )
      );
    }
    return map;
  }, [alerts, dbUnits, dbConversions]);

  const { suppliers, categories } = useMemo(() => {
    if (!alerts) return { suppliers: [], categories: [] };
    const sMap = new Map<string, string>();
    const cSet = new Set<string>();
    for (const a of alerts) {
      for (const s of a.all_suppliers) {
        sMap.set(s.id, s.name);
      }
      if (a.category) cSet.add(a.category);
    }
    return {
      suppliers: Array.from(sMap, ([id, name]) => ({ id, name })).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
      categories: Array.from(cSet).sort(),
    };
  }, [alerts]);

  const activeFilterCount = [supplierFilter, categoryFilter, alertFilter].filter(Boolean).length;

  const { mainAlerts, errorAlerts } = useMemo(() => {
    if (!alerts) return { mainAlerts: [], errorAlerts: [] };
    let list = alerts;
    if (supplierFilter)
      list = list.filter((a) => a.all_suppliers.some((s) => s.id === supplierFilter));
    if (categoryFilter) list = list.filter((a) => a.category === categoryFilter);
    if (alertFilter) {
      if (alertFilter === "rupture") list = list.filter((a) => a.alert_level === "rupture");
      else if (alertFilter === "warning") list = list.filter((a) => a.alert_level === "warning");
      else if (alertFilter === "error") list = list.filter((a) => a.alert_level === "error");
    }
    if (!showOk) list = list.filter((a) => a.alert_level !== "ok");
    const main = list.filter((a) => a.alert_level !== "error");
    const errors = list.filter((a) => a.alert_level === "error");

    const alertPriority: Record<string, number> = { rupture: 0, warning: 1, ok: 2 };
    const sortFn = (a: StockAlertItem, b: StockAlertItem) => {
      // 1. Ruptures first, then warnings, then ok
      const pa = alertPriority[a.alert_level] ?? 3;
      const pb = alertPriority[b.alert_level] ?? 3;
      if (pa !== pb) return pa - pb;
      // 2. Within same level, lowest stock first
      const qa = a.estimated_quantity ?? Infinity;
      const qb = b.estimated_quantity ?? Infinity;
      if (qa !== qb) return qa - qb;
      // 3. Supplier sort if active
      if (sortMode === "supplier") {
        const sA = a.all_suppliers[0]?.name ?? "";
        const sB = b.all_suppliers[0]?.name ?? "";
        const cmp = sA.localeCompare(sB);
        if (cmp !== 0) return cmp;
      }
      return a.product_name.localeCompare(b.product_name);
    };

    return { mainAlerts: [...main].sort(sortFn), errorAlerts: [...errors].sort(sortFn) };
  }, [alerts, supplierFilter, categoryFilter, alertFilter, showOk, sortMode]);

  const counts = useMemo(() => {
    if (!alerts) return { rupture: 0, warning: 0, error: 0, ok: 0 };
    return {
      rupture: alerts.filter((a) => a.alert_level === "rupture").length,
      warning: alerts.filter((a) => a.alert_level === "warning").length,
      error: alerts.filter((a) => a.alert_level === "error").length,
      ok: alerts.filter((a) => a.alert_level === "ok").length,
    };
  }, [alerts]);

  return (
    <div className="py-4 px-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="shrink-0"
            aria-label="Retour"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <h1 className="text-lg font-semibold flex-1">Alertes stock</h1>

        {/* Filter sheet trigger */}
        <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1 relative">
              <Filter className="h-4 w-4" />
              Filtres
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full text-[10px] w-4 h-4 flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="space-y-4 pb-8">
            <SheetHeader>
              <SheetTitle>Filtres alertes</SheetTitle>
            </SheetHeader>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Zone */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Zone</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      !zoneFilter
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-foreground border-border"
                    )}
                    onClick={() => setZoneFilter(null)}
                  >
                    Toutes
                  </button>
                  {zones.map((z) => (
                    <button
                      key={z.id}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                        zoneFilter === z.id
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/50 text-foreground border-border"
                      )}
                      onClick={() => setZoneFilter(zoneFilter === z.id ? null : z.id)}
                    >
                      {z.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fournisseur */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Fournisseur</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      !supplierFilter
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-foreground border-border"
                    )}
                    onClick={() => setSupplierFilter(null)}
                  >
                    Tous
                  </button>
                  {suppliers.map((s) => (
                    <button
                      key={s.id}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                        supplierFilter === s.id
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/50 text-foreground border-border"
                      )}
                      onClick={() => setSupplierFilter(supplierFilter === s.id ? null : s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Catégorie */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Catégorie</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      !categoryFilter
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-foreground border-border"
                    )}
                    onClick={() => setCategoryFilter(null)}
                  >
                    Toutes
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                        categoryFilter === c
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/50 text-foreground border-border"
                      )}
                      onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type d'alerte */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Type d'alerte</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      !alertFilter
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-foreground border-border"
                    )}
                    onClick={() => setAlertFilter(null)}
                  >
                    Toutes
                  </button>
                  {[
                    { value: "rupture", label: "Rupture" },
                    { value: "warning", label: "Sous minimum" },
                    { value: "error", label: "Non calculable" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                        alertFilter === opt.value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/50 text-foreground border-border"
                      )}
                      onClick={() => setAlertFilter(alertFilter === opt.value ? null : opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setZoneFilter(null);
                  setSupplierFilter(null);
                  setCategoryFilter(null);
                  setAlertFilter(null);
                }}
              >
                Réinitialiser les filtres
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Display mode + Sort + Summary badges */}
      <div className="flex gap-2 items-center flex-wrap">
        <Select value={displayMode} onValueChange={(v) => setDisplayMode(v as DisplayMode)}>
          <SelectTrigger className="h-7 text-xs w-auto min-w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-background z-50">
            <SelectItem value="reference">Réf.</SelectItem>
            <SelectItem value="supplier">Fourn.</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={sortMode === "supplier" ? "secondary" : "outline"}
          size="sm"
          className="text-xs gap-1 h-7"
          onClick={() => setSortMode(sortMode === "alpha" ? "supplier" : "alpha")}
        >
          {sortMode === "supplier" ? (
            <><Building2 className="h-3 w-3" /> Fourn.</>
          ) : (
            <><ArrowDownAZ className="h-3 w-3" /> A-Z</>
          )}
        </Button>
      </div>

      {/* Quick filter badges */}
      {!isLoading && alerts && (
        <div className="flex gap-1.5 flex-wrap">
          {counts.rupture > 0 && (
            <Badge
              variant="outline"
              className={cn(
                "text-[11px] cursor-pointer text-destructive border-destructive/30 px-2 py-0.5",
                alertFilter === "rupture" && "ring-2 ring-ring ring-offset-1"
              )}
              onClick={() => setAlertFilter(alertFilter === "rupture" ? null : "rupture")}
            >
              {counts.rupture} ✕
            </Badge>
          )}
          {counts.warning > 0 && (
            <Badge
              variant="outline"
              className={cn(
                "text-[11px] cursor-pointer text-amber-600 dark:text-amber-400 border-amber-500/30 px-2 py-0.5",
                alertFilter === "warning" && "ring-2 ring-ring ring-offset-1"
              )}
              onClick={() => setAlertFilter(alertFilter === "warning" ? null : "warning")}
            >
              {counts.warning} ⚠
            </Badge>
          )}
          {counts.error > 0 && (
            <Badge
              variant="outline"
              className={cn(
                "text-[11px] cursor-pointer text-muted-foreground px-2 py-0.5",
                alertFilter === "error" && "ring-2 ring-ring ring-offset-1"
              )}
              onClick={() => setAlertFilter(alertFilter === "error" ? null : "error")}
            >
              {counts.error} err
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn(
              "text-[11px] cursor-pointer text-emerald-600 dark:text-emerald-400 border-emerald-500/30 px-2 py-0.5",
              showOk && "ring-2 ring-ring ring-offset-1"
            )}
            onClick={() => setShowOk(!showOk)}
          >
            {counts.ok} OK {showOk ? "▾" : "▸"}
          </Badge>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Error */}
      {!isLoading && alertsError && (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <p className="text-destructive font-medium">Une erreur est survenue</p>
          <p className="text-muted-foreground text-sm mt-1">
            Impossible de charger les alertes.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetchAlerts()}>
            Réessayer
          </Button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !alertsError && mainAlerts.length === 0 && errorAlerts.length === 0 && (
        <div className="py-12 text-center text-muted-foreground text-sm">
          {alerts?.length === 0
            ? "Aucun produit avec inventaire actif."
            : "Aucune alerte — tous les produits sont au-dessus du minimum."}
        </div>
      )}

      {/* Main alerts — compact list */}
      {!isLoading && mainAlerts.length > 0 && (
        <div className="space-y-1.5">
          {mainAlerts.map((item) => (
            <AlertLine
              key={`${item.product_id}-${item.storage_zone_id}`}
              item={item}
              displayMode={displayMode}
              ctx={productContexts.get(item.product_id) ?? null}
            />
          ))}
        </div>
      )}

      {/* OK items */}
      {!isLoading && showOk && alerts && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 pt-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            OK ({alerts.filter((a) => a.alert_level === "ok").length})
          </h3>
          {alerts
            .filter((a) => a.alert_level === "ok")
            .filter((a) => {
              if (supplierFilter && !a.all_suppliers.some((s) => s.id === supplierFilter))
                return false;
              if (categoryFilter && a.category !== categoryFilter) return false;
              return true;
            })
            .map((item) => (
              <AlertLine
                key={`${item.product_id}-${item.storage_zone_id}`}
                item={item}
                displayMode={displayMode}
                ctx={productContexts.get(item.product_id) ?? null}
              />
            ))}
        </div>
      )}

      {/* Error section */}
      {!isLoading && errorAlerts.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 pt-2">
            <AlertOctagon className="h-3.5 w-3.5" />
            À corriger ({errorAlerts.length})
          </h3>
          {errorAlerts.map((item) => (
            <AlertLine
              key={`${item.product_id}-${item.storage_zone_id}`}
              item={item}
              displayMode={displayMode}
              ctx={productContexts.get(item.product_id) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
