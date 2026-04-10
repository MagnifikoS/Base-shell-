/**
 * DLC V1 — Vue de surveillance "DLC critique".
 * Mobile-first, épuré. Affiche les produits avec DLC expirée ou proche.
 * Card cliquable → action sheet (modifier DLC / retirer du stock).
 */

import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  AlertTriangle,
  ShieldAlert,
  RefreshCcw,
  Package,
  Clock,
  CalendarIcon,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDlcCritique, type DlcCritiqueItem } from "../hooks/useDlcCritique";
import { useUpdateDlcDate, useDismissDlcAlert } from "../hooks/useDlcCritiqueActions";
import { formatDlcDate, computeDlcDaysRemaining } from "../lib/dlcCompute";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatQtyDisplay } from "@/modules/inventaire/components/inventoryDisplayUtils";

export function DlcCritiquePage() {
  const { items, criticalItems, expiredCount, warningCount, totalCritical, isLoading, refetch } =
    useDlcCritique();

  const expiredItems = criticalItems.filter((i) => i.status === "expired");
  const warningItems = criticalItems.filter((i) => i.status === "warning");
  const okItems = items.filter((i) => i.status === "ok");

  return (
    <div className="w-full max-w-2xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 sm:h-6 sm:w-6 text-amber-500 shrink-0" />
            DLC critique
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Surveillance péremptions
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="shrink-0">
          <RefreshCcw className="h-4 w-4" />
          <span className="hidden sm:inline ml-1.5">Actualiser</span>
        </Button>
      </div>

      {/* Summary counters */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className={`rounded-xl p-3 sm:p-4 border ${
          expiredCount > 0
            ? "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
            : "bg-card border-border"
        }`}>
          <div className="flex items-center gap-2">
            <AlertTriangle className={`h-4 w-4 ${expiredCount > 0 ? "text-red-500" : "text-muted-foreground"}`} />
            <span className={`text-2xl sm:text-3xl font-bold tabular-nums ${expiredCount > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
              {expiredCount}
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-muted-foreground mt-1">Expiré{expiredCount > 1 ? "s" : ""}</p>
        </div>
        <div className={`rounded-xl p-3 sm:p-4 border ${
          warningCount > 0
            ? "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800"
            : "bg-card border-border"
        }`}>
          <div className="flex items-center gap-2">
            <Clock className={`h-4 w-4 ${warningCount > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
            <span className={`text-2xl sm:text-3xl font-bold tabular-nums ${warningCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
              {warningCount}
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-muted-foreground mt-1">Proche{warningCount > 1 ? "s" : ""}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          Chargement…
        </div>
      ) : (
        <div className="space-y-5 sm:space-y-6">
          {expiredItems.length > 0 && (
            <DlcSection title="Dépassée" icon="expired" items={expiredItems} />
          )}

          {warningItems.length > 0 && (
            <DlcSection title="Proche" icon="warning" items={warningItems} />
          )}

          {okItems.length > 0 && totalCritical > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors py-2 flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" />
                {okItems.length} produit{okItems.length > 1 ? "s" : ""} OK
              </summary>
              <div className="mt-2 space-y-1.5">
                {okItems.map((item) => (
                  <DlcCard key={item.id} item={item} />
                ))}
              </div>
            </details>
          )}

          {totalCritical === 0 && okItems.length > 0 && (
            <div className="space-y-1.5">
              {okItems.map((item) => (
                <DlcCard key={item.id} item={item} />
              ))}
            </div>
          )}

          {items.length === 0 && (
            <div className="text-center py-16 text-muted-foreground space-y-3">
              <Package className="h-10 w-10 mx-auto opacity-30" />
              <p className="text-sm font-medium">Aucune DLC enregistrée</p>
              <p className="text-xs max-w-xs mx-auto">
                Les dates de péremption apparaîtront ici après réception de commandes
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function DlcSection({
  title,
  icon,
  items,
}: {
  title: string;
  icon: "expired" | "warning";
  items: DlcCritiqueItem[];
}) {
  const isExpired = icon === "expired";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        {isExpired ? (
          <AlertTriangle className="h-4 w-4 text-red-500" />
        ) : (
          <Clock className="h-4 w-4 text-amber-500" />
        )}
        <span className="text-sm font-semibold">{title}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
          isExpired
            ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
            : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
        }`}>
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <DlcCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function DlcCard({ item }: { item: DlcCritiqueItem }) {
  const daysRemaining = computeDlcDaysRemaining(item.dlc_date);
  const isExpired = item.status === "expired";
  const isWarning = item.status === "warning";

  const [expanded, setExpanded] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [dismissDialogOpen, setDismissDialogOpen] = useState(false);

  const updateDate = useUpdateDlcDate();
  const dismissAlert = useDismissDlcAlert();

  const daysLabel = isExpired
    ? daysRemaining === 0 ? "expire aujourd'hui" : `expiré depuis ${Math.abs(daysRemaining)}j`
    : daysRemaining === 0
      ? "expire aujourd'hui"
      : `expire dans ${daysRemaining}j`;

  const cardBorder = isExpired
    ? "border-red-200/80 dark:border-red-800/40"
    : isWarning
      ? "border-amber-200/80 dark:border-amber-800/40"
      : "border-border";

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    const isoDate = format(date, "yyyy-MM-dd");
    updateDate.mutate(
      { lotId: item.id, newDate: isoDate },
      {
        onSuccess: () => {
          toast.success("Date DLC mise à jour");
          setEditingDate(false);
          setExpanded(false);
        },
        onError: () => toast.error("Erreur lors de la mise à jour"),
      }
    );
  };

  const handleDismiss = () => {
    dismissAlert.mutate(
      { lotId: item.id, reason: "removed_from_stock" },
      {
        onSuccess: () => {
          toast.success("Alerte traitée — produit retiré");
          setDismissDialogOpen(false);
          setExpanded(false);
        },
        onError: () => toast.error("Erreur lors du traitement"),
      }
    );
  };

  const currentDlcDate = new Date(item.dlc_date + "T00:00:00");

  return (
    <>
      <div
        className={cn(
          "rounded-xl border bg-card transition-all",
          cardBorder,
          expanded && "ring-1 ring-primary/20"
        )}
      >
        {/* Clickable main row */}
        <button
          type="button"
          className="w-full flex items-center justify-between gap-3 px-3 py-3 text-left active:bg-muted/40 transition-colors rounded-xl"
          onClick={() => setExpanded(!expanded)}
        >
          {/* Product info — left */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate leading-tight">{item.product_name}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatDlcDate(item.dlc_date)}
              </span>
              <span className={cn(
                "text-[11px] font-semibold tabular-nums",
                isExpired ? "text-red-500" : isWarning ? "text-amber-500" : "text-muted-foreground"
              )}>
                {daysLabel}
              </span>
            </div>
          </div>

          {/* Quantity + unit — right-aligned */}
          <div className="shrink-0 flex items-baseline gap-1 text-right">
            <span className={cn(
              "text-lg font-bold tabular-nums leading-none",
              isExpired ? "text-red-600 dark:text-red-400" : isWarning ? "text-amber-600 dark:text-amber-400" : "text-foreground"
            )}>
              {formatQtyDisplay(item.quantity_received)}
            </span>
            {item.unit_label && (
              <span className={cn(
                "text-xs font-medium",
                isExpired ? "text-red-500/70 dark:text-red-400/70" : isWarning ? "text-amber-500/70 dark:text-amber-400/70" : "text-muted-foreground"
              )}>
                {item.unit_label}
              </span>
            )}
          </div>
        </button>

        {/* Expanded action panel */}
        {expanded && (
          <div className="px-3 pb-3 pt-0 flex gap-2 animate-in fade-in slide-in-from-top-1 duration-150">
            <Popover open={editingDate} onOpenChange={setEditingDate}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs gap-2 flex-1 font-medium"
                  disabled={updateDate.isPending}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Modifier DLC
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={currentDlcDate}
                  onSelect={handleDateSelect}
                  locale={fr}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>

            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs gap-2 flex-1 font-medium text-destructive hover:text-destructive hover:bg-destructive/5"
              onClick={() => setDismissDialogOpen(true)}
              disabled={dismissAlert.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Retirer du stock
            </Button>
          </div>
        )}
      </div>

      {/* Dismiss confirmation dialog */}
      <AlertDialog open={dismissDialogOpen} onOpenChange={setDismissDialogOpen}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer le retrait</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{item.product_name}</span> sera retiré de la surveillance DLC.
              <br /><br />
              Aucune modification de stock ne sera effectuée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDismiss}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
