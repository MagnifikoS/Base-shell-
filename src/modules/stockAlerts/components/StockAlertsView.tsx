/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STOCK ALERTS VIEW (Desktop) — Clean, minimal design
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { useStockAlerts, type StockAlertItem, type AlertLevel } from "../hooks/useStockAlerts";
import { useAutoInitializeErrorProducts } from "../hooks/useAutoInitializeErrorProducts";
import { useStorageZones } from "@/modules/produitsV2";
import { useUnits } from "@/hooks/useUnits";
import { useUnitConversions } from "@/core/unitConversion";
import { resolveProductUnitContext, type ProductUnitContext } from "@/core/unitConversion";
import type { ConditioningConfig } from "@/modules/produitsV2";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertTriangle,
  XCircle,
  AlertOctagon,
  CheckCircle2,
  ExternalLink,
  Settings2,
  ArrowDownAZ,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useMutualisationEnabled,
  useMutualisationGroups,
  applyMutualisationAlerts,
  type AlertDisplayItem,
} from "@/modules/inventaireMutualisation";

// ─────────────────────────────────────────────────────────────────────────────
type DisplayMode = "reference" | "supplier";

// ─────────────────────────────────────────────────────────────────────────────

function AlertBadge({ level }: { level: AlertLevel }) {
  switch (level) {
    case "rupture":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
          <XCircle className="h-3.5 w-3.5" /> Rupture
        </span>
      );
    case "warning":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" /> Sous seuil
        </span>
      );
    case "error":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground cursor-help">
              <AlertOctagon className="h-3.5 w-3.5" /> Non calculable
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[250px]">
            <p className="text-xs">Voir la colonne "Raison" pour le détail.</p>
          </TooltipContent>
        </Tooltip>
      );
    case "ok":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" /> OK
        </span>
      );
  }
}

function formatQty(qty: number | null): string {
  if (qty == null) return "—";
  if (Math.abs(qty) < 1) return (Math.round(qty * 1000) / 1000).toString();
  return (Math.round(qty * 100) / 100).toString();
}

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
    return { value: canonicalQty, label: ctx.canonicalLabel, error: false };
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
    label: `${supplierUnit.name} (${supplierUnit.abbreviation})`,
    error: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function StockAlertsView() {
  const navigate = useNavigate();
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [alertFilter, setAlertFilter] = useState<string | null>(null);
  const [showOk, setShowOk] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("reference");
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

  // ── Mutualisation (presentation-only) ──────────────────────────────
  const { enabled: mutualisationOn } = useMutualisationEnabled();
  const { groups: mutualisationGroups } = useMutualisationGroups();

  // Resolve unit context per product
  const productContexts = useMemo(() => {
    if (!alerts || !dbUnits.length) return new Map<string, ProductUnitContext>();
    const map = new Map<string, ProductUnitContext>();
    for (const item of alerts) {
      if (map.has(item.product_id) || !item.product_unit_config) continue;
      const cfg = item.product_unit_config;
      const ctx = resolveProductUnitContext(
        {
          stock_handling_unit_id: cfg.stock_handling_unit_id,
          final_unit_id: cfg.final_unit_id,
          delivery_unit_id: cfg.delivery_unit_id,
          supplier_billing_unit_id: cfg.supplier_billing_unit_id,
          conditionnement_config: cfg.conditionnement_config as ConditioningConfig | null,
        },
        dbUnits,
        dbConversions
      );
      map.set(item.product_id, ctx);
    }
    return map;
  }, [alerts, dbUnits, dbConversions]);

  // Extract unique suppliers and categories
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

  // Apply filters
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

  // Apply mutualisation grouping to mainAlerts (presentation only)
  // Pass full `alerts` so groups aggregate ALL real members, not just filtered ones.
  const mutualisedAlerts = useMemo(() => {
    if (!mutualisationOn || mutualisationGroups.length === 0 || !alerts) return null;
    return applyMutualisationAlerts(mainAlerts, mutualisationGroups, alerts);
  }, [mutualisationOn, mutualisationGroups, mainAlerts, alerts]);

  const counts = useMemo(() => {
    if (!alerts) return { rupture: 0, warning: 0, error: 0, ok: 0 };
    return {
      rupture: alerts.filter((a) => a.alert_level === "rupture").length,
      warning: alerts.filter((a) => a.alert_level === "warning").length,
      error: alerts.filter((a) => a.alert_level === "error").length,
      ok: alerts.filter((a) => a.alert_level === "ok").length,
    };
  }, [alerts]);

  const handleViewProduct = (item: StockAlertItem) => {
    navigate(`/produits-v2/${item.product_id}`);
  };

  const handleOpenWizard = (item: StockAlertItem) => {
    navigate(`/produits-v2/${item.product_id}?wizard=true`);
  };

  const renderRow = (item: StockAlertItem) => {
    const ctx = productContexts.get(item.product_id) ?? null;
    const deliveryUnitId = item.product_unit_config?.delivery_unit_id ?? null;
    const stockD = convertToDisplay(item.estimated_quantity, displayMode, ctx, deliveryUnitId);
    const minD = convertToDisplay(item.min_stock_canonical, displayMode, ctx, deliveryUnitId);

    return (
      <TableRow
        key={`${item.product_id}-${item.storage_zone_id}`}
        className={cn(
          "border-l-2 transition-colors",
          item.alert_level === "rupture"
            ? "border-l-destructive"
            : item.alert_level === "warning"
              ? "border-l-amber-400 dark:border-l-amber-500"
              : "border-l-transparent"
        )}
      >
        <TableCell className="font-medium text-sm max-w-[220px] truncate">
          <button
            onClick={() => handleViewProduct(item)}
            className="hover:text-primary transition-colors text-left truncate block w-full"
          >
            {item.product_name}
          </button>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {item.storage_zone_name ?? "—"}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {item.all_suppliers.length === 0 ? (
            "—"
          ) : item.all_suppliers.length === 1 ? (
            item.all_suppliers[0].name
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    {item.all_suppliers[0].name}
                    <span className="text-xs ml-1 text-muted-foreground/60">
                      +{item.all_suppliers.length - 1}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[250px]">
                  <p className="text-xs font-medium mb-1">Disponible chez :</p>
                  {item.all_suppliers.map((s) => (
                    <p key={s.id} className="text-xs">
                      {s.name}
                    </p>
                  ))}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums text-sm">
          {item.alert_level === "error" ? (
            <span className="text-muted-foreground">—</span>
          ) : stockD.error ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground cursor-help">—</span>
                </TooltipTrigger>
                <TooltipContent>Conversion indisponible</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span>
              <span className="font-medium">{formatQty(stockD.value)}</span>{" "}
              <span className="text-muted-foreground text-xs">{stockD.label}</span>
            </span>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums text-sm">
          {item.alert_level === "error" ? (
            <span className="text-muted-foreground">—</span>
          ) : minD.error ? (
            <span className="text-muted-foreground">--</span>
          ) : (
            <span>
              <span className="font-medium">{formatQty(minD.value)}</span>{" "}
              <span className="text-muted-foreground text-xs">{minD.label}</span>
            </span>
          )}
        </TableCell>
        <TableCell>
          <AlertBadge level={item.alert_level} />
        </TableCell>
        <TableCell>
          {item.alert_level === "error" ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1 h-7"
              onClick={() => handleOpenWizard(item)}
            >
              <Settings2 className="h-3 w-3" />
              Corriger
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1 h-7 text-muted-foreground hover:text-foreground"
              onClick={() => handleViewProduct(item)}
            >
              <ExternalLink className="h-3 w-3" />
              Voir
            </Button>
          )}
        </TableCell>
      </TableRow>
    );
  };

  const renderGroupAlertRow = (item: AlertDisplayItem<StockAlertItem>) => {
    if (item.type === "individual" && item.item) {
      return renderRow(item.item);
    }
    if (item.type === "group" && item.groupAlert) {
      const ga = item.groupAlert;
      return (
        <TableRow
          key={`group-${ga.groupId}`}
          className={cn(
            "border-l-2 bg-muted/20",
            ga.alertLevel === "rupture"
              ? "border-l-destructive"
              : ga.alertLevel === "warning"
                ? "border-l-amber-400 dark:border-l-amber-500"
                : "border-l-transparent"
          )}
        >
          <TableCell className="font-semibold text-sm" colSpan={3}>
            <div className="flex items-center gap-2">
              <span className="text-primary">⊞</span>
              {ga.displayName}
              <span className="text-xs text-muted-foreground font-normal">
                ({ga.members.length} produits mutualisés)
              </span>
            </div>
          </TableCell>
          <TableCell className="text-right tabular-nums text-sm font-medium">
            {ga.aggregatedQuantity !== null ? formatQty(ga.aggregatedQuantity) : "—"}
          </TableCell>
          <TableCell className="text-right tabular-nums text-sm font-medium">
            {ga.carrierMinStock !== null ? formatQty(ga.carrierMinStock) : "—"}
          </TableCell>
          <TableCell>
            <AlertBadge level={ga.alertLevel} />
          </TableCell>
          <TableCell />
        </TableRow>
      );
    }
    return null;
  };

  return (
    <div className="space-y-5">
      {/* Header + Filters */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Alertes stock</h2>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={displayMode} onValueChange={(v) => setDisplayMode(v as DisplayMode)}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              <SelectItem value="reference">Unité de référence</SelectItem>
              <SelectItem value="supplier">Unité fournisseur</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={zoneFilter ?? "__all__"}
            onValueChange={(v) => setZoneFilter(v === "__all__" ? null : v)}
          >
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="Toutes les zones" />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              <SelectItem value="__all__">Toutes les zones</SelectItem>
              {zones.map((z) => (
                <SelectItem key={z.id} value={z.id}>
                  {z.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={supplierFilter ?? "__all__"}
            onValueChange={(v) => setSupplierFilter(v === "__all__" ? null : v)}
          >
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="Tous fournisseurs" />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              <SelectItem value="__all__">Tous fournisseurs</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={categoryFilter ?? "__all__"}
            onValueChange={(v) => setCategoryFilter(v === "__all__" ? null : v)}
          >
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="Toutes catégories" />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              <SelectItem value="__all__">Toutes catégories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={alertFilter ?? "__all__"}
            onValueChange={(v) => setAlertFilter(v === "__all__" ? null : v)}
          >
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Toutes alertes" />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              <SelectItem value="__all__">Toutes alertes</SelectItem>
              <SelectItem value="rupture">Rupture</SelectItem>
              <SelectItem value="warning">Sous minimum</SelectItem>
              <SelectItem value="error">Non calculable</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary chips + sort */}
      {!isLoading && alerts && (
        <div className="flex gap-2 flex-wrap items-center">
          <Button
            variant={sortMode === "supplier" ? "secondary" : "outline"}
            size="sm"
            className="text-xs gap-1.5 h-7"
            onClick={() => setSortMode(sortMode === "alpha" ? "supplier" : "alpha")}
          >
            {sortMode === "supplier" ? (
              <><Building2 className="h-3 w-3" /> Par fournisseur</>
            ) : (
              <><ArrowDownAZ className="h-3 w-3" /> Alphabétique</>
            )}
          </Button>

          <div className="w-px h-4 bg-border mx-1" />

          {counts.rupture > 0 && (
            <button
              onClick={() => setAlertFilter(alertFilter === "rupture" ? null : "rupture")}
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                "text-destructive bg-destructive/8 hover:bg-destructive/12",
                alertFilter === "rupture" && "ring-1 ring-destructive/40"
              )}
            >
              <XCircle className="h-3 w-3" />
              {counts.rupture} rupture{counts.rupture > 1 ? "s" : ""}
            </button>
          )}
          {counts.warning > 0 && (
            <button
              onClick={() => setAlertFilter(alertFilter === "warning" ? null : "warning")}
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                "text-amber-600 dark:text-amber-400 bg-amber-500/8 hover:bg-amber-500/12",
                alertFilter === "warning" && "ring-1 ring-amber-400/40"
              )}
            >
              <AlertTriangle className="h-3 w-3" />
              {counts.warning} sous seuil
            </button>
          )}
          {counts.error > 0 && (
            <button
              onClick={() => setAlertFilter(alertFilter === "error" ? null : "error")}
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                "text-muted-foreground bg-muted hover:bg-muted/80",
                alertFilter === "error" && "ring-1 ring-border"
              )}
            >
              <AlertOctagon className="h-3 w-3" />
              {counts.error} non calculable{counts.error > 1 ? "s" : ""}
            </button>
          )}

          <button
            onClick={() => setShowOk(!showOk)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            {showOk ? "Masquer OK" : `Afficher ${counts.ok} OK`}
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {/* Error */}
      {!isLoading && alertsError && (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <p className="text-destructive font-medium">Une erreur est survenue</p>
          <p className="text-muted-foreground text-sm mt-1">
            Impossible de charger les alertes de stock.
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
            ? "Aucun produit avec inventaire actif dans cette zone."
            : "Aucune alerte — tous les produits sont au-dessus du minimum."}
        </div>
      )}

      {/* Main table */}
      {!isLoading && mainAlerts.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs uppercase tracking-wider">Produit</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Zone</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Fournisseur</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-right">Stock</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-right">Seuil</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Statut</TableHead>
                <TableHead className="text-xs uppercase tracking-wider w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mutualisedAlerts
                ? mutualisedAlerts
                    .filter((item) => {
                      // Hide group-level "ok" when showOk is off (same logic as individual alerts)
                      if (!showOk && item.type === "group" && item.groupAlert?.alertLevel === "ok") return false;
                      return true;
                    })
                    .map((item, idx) => (
                      <Fragment key={idx}>{renderGroupAlertRow(item)}</Fragment>
                    ))
                : mainAlerts.map(renderRow)}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Error section */}
      {!isLoading && errorAlerts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <AlertOctagon className="h-4 w-4" />
            Produits à corriger ({errorAlerts.length})
          </h3>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs uppercase tracking-wider">Produit</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Zone</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Fournisseur</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Erreur</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errorAlerts.map((item) => (
                  <TableRow key={`${item.product_id}-${item.storage_zone_id}`} className="border-l-2 border-l-transparent">
                    <TableCell className="font-medium text-sm max-w-[200px] truncate">
                      {item.product_name}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.storage_zone_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.all_suppliers.length === 0
                        ? "—"
                        : item.all_suppliers.map((s) => s.name).join(", ")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[250px] truncate">
                      {item.error_message}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs gap-1 h-7"
                        onClick={() => handleOpenWizard(item)}
                      >
                        <Settings2 className="h-3 w-3" />
                        Corriger
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
