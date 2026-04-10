/**
 * UnifiedCommandesList — Clean mobile-first product order list.
 * Tabs: En cours | Terminée | +
 * Litige/Retours accessible via warning icon in header.
 */

import { useState, useMemo, lazy, Suspense } from "react";
import { RetoursList, useReturns } from "@/modules/retours";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStaleLitiges } from "@/modules/litiges/hooks/useStaleLitiges";
import {
  Plus,
  Loader2,
  Inbox,
  PackageSearch,
  Trash2,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  CheckCircle2,
  Package,
  ShoppingCart,
} from "lucide-react";
import { computeEcart } from "@/modules/litiges/utils/ecart";
import { formatParisHHMM } from "@/lib/time/paris";
import { formatParisDateKey } from "@/lib/time/dateKeyParis";
import { toast } from "sonner";
import { useDeleteDraftCommande } from "@/modules/commandes/hooks/useCommandes";
import { CommandeStatusBadge } from "@/modules/commandes/components/CommandeStatusBadge";
import type { CommandeStatus } from "@/modules/commandes/types";
import type { UnifiedItem, ProductCommandeResolved } from "./useUnifiedCommandes";
import { useUnifiedCommandes, isEnCours } from "./useUnifiedCommandes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Props {
  onNewCommande: () => void;
  onViewItem: (item: UnifiedItem) => void;
  establishmentNames: Record<string, string>;
}

const OrderPrepTab = lazy(() =>
  import("@/modules/orderPrep").then((m) => ({ default: m.OrderPrepTab }))
);

type TabKey = "en_cours" | "litige" | "retours" | "terminee" | "a_commander";

const allMainTabs: { key: Extract<TabKey, "en_cours" | "terminee" | "a_commander">; label: string; icon: typeof PackageSearch }[] = [
  { key: "en_cours", label: "En cours", icon: PackageSearch },
  { key: "terminee", label: "Terminée", icon: CheckCircle2 },
  { key: "a_commander", label: "À commander", icon: ShoppingCart },
];

function formatDateTimeParis(iso: string): string {
  const dateKey = formatParisDateKey(new Date(iso));
  const [, mm, dd] = dateKey.split("-");
  const time = formatParisHHMM(iso);
  return `${dd}/${mm} · ${time}`;
}

export function UnifiedCommandesList({
  onNewCommande,
  onViewItem,
  establishmentNames,
}: Props) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const isFournisseur = activeEstablishment?.establishment_type === "fournisseur";
  const mainTabs = useMemo(() => isFournisseur ? allMainTabs : allMainTabs.filter(t => t.key !== "a_commander"), [isFournisseur]);
  const { items, isLoading } = useUnifiedCommandes();
  const deleteProductDraft = useDeleteDraftCommande();
  const [filter, setFilter] = useState<TabKey>("en_cours");

  const { data: allReturns } = useReturns({ enabled: true });
  const returnsCount = allReturns?.filter((r) => r.status === "pending").length ?? 0;

  // Litige count
  const litigeCount = useMemo(
    () => items.filter((i) => i.data.status === "litige").length,
    [items]
  );

  const hasAlerts = litigeCount > 0 || returnsCount > 0;

  // Litige écart data for product commandes
  const litigeProductIds = useMemo(
    () => items.filter((i) => i.data.status === "litige").map((i) => i.data.id),
    [items]
  );

  const { data: litigeLines } = useQuery({
    queryKey: ["commande-lines-litige", litigeProductIds],
    queryFn: async () => {
      if (litigeProductIds.length === 0) return [];
      const { data, error } = await db
        .from("commande_lines")
        .select("commande_id, shipped_quantity, received_quantity")
        .in("commande_id", litigeProductIds);
      if (error) throw error;
      return (data ?? []) as { commande_id: string; shipped_quantity: number | null; received_quantity: number | null }[];
    },
    enabled: litigeProductIds.length > 0 && filter === "litige",
    staleTime: 30_000,
  });

  const ecartMap = useMemo(() => {
    const map = new Map<string, { manqueCount: number; surplusCount: number; totalManque: number; totalSurplus: number }>();
    if (!litigeLines) return map;
    for (const line of litigeLines) {
      const shipped = line.shipped_quantity ?? 0;
      const received = line.received_quantity ?? 0;
      const { type, absDelta } = computeEcart(shipped, received);
      if (type === "ok") continue;
      let entry = map.get(line.commande_id);
      if (!entry) {
        entry = { manqueCount: 0, surplusCount: 0, totalManque: 0, totalSurplus: 0 };
        map.set(line.commande_id, entry);
      }
      if (type === "manque") { entry.manqueCount++; entry.totalManque += absDelta; }
      else { entry.surplusCount++; entry.totalSurplus += absDelta; }
    }
    return map;
  }, [litigeLines]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const filtered = (filter === "retours" || filter === "a_commander") ? [] : items.filter((i) => {
    const s = i.data.status;
    if (filter === "en_cours") return isEnCours(s);
    if (filter === "litige") return s === "litige";
    if (filter === "terminee") return ["recue", "cloturee"].includes(s);
    return true;
  });

  // Is viewing an alert sub-view (litige or retours)?
  const isAlertView = filter === "litige" || filter === "retours";

  return (
    <div className="space-y-4">
      {/* ── Header: Title + Warning button ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Commandes</h1>
        {hasAlerts && !isAlertView && (
          <button
            onClick={() => setFilter(litigeCount > 0 ? "litige" : "retours")}
            className="relative flex items-center justify-center h-9 w-9 rounded-xl bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20 active:scale-95"
            aria-label="Voir les litiges et retours"
          >
            <AlertTriangle className="h-4.5 w-4.5" />
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground px-1">
              {litigeCount + returnsCount}
            </span>
          </button>
        )}
        {isAlertView && (
          <button
            onClick={() => setFilter("en_cours")}
            className="text-xs font-medium text-primary px-3 py-1.5 rounded-lg hover:bg-primary/10 transition-colors"
          >
            ← Retour
          </button>
        )}
      </div>

      {/* ── Alert sub-header when in litige/retours view ── */}
      {isAlertView && (
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("litige")}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              filter === "litige"
                ? "bg-destructive/10 text-destructive border border-destructive/20"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Litiges
            {litigeCount > 0 && (
              <span className="ml-1 bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 rounded-full">
                {litigeCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setFilter("retours")}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              filter === "retours"
                ? "bg-destructive/10 text-destructive border border-destructive/20"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            Retours
            {returnsCount > 0 && (
              <span className="ml-1 bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 rounded-full">
                {returnsCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ── Main tabs (only when not in alert view) ── */}
      {!isAlertView && (
        <div className="flex items-center gap-2">
          <div className="flex gap-1 p-1 rounded-xl bg-muted/40 flex-1">
            {mainTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = filter === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  className={`flex items-center justify-center gap-1 px-2 py-2.5 rounded-lg text-[11px] font-medium transition-all flex-1 min-w-0 ${
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
          <button
            onClick={onNewCommande}
            className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary text-primary-foreground shadow-sm shrink-0 active:scale-95 transition-transform"
            aria-label="Nouvelle commande"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Stale warnings */}
      <StaleLitigesWarning />

      {/* Retours */}
      {filter === "retours" && <RetoursList establishmentNames={establishmentNames} />}

      {/* À commander */}
      {filter === "a_commander" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
          <OrderPrepTab />
        </Suspense>
      )}

      {/* Empty */}
      {filter !== "retours" && filter !== "a_commander" && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Inbox className="h-10 w-10 mb-3 opacity-30" />
          <p className="font-medium text-sm">Aucune commande</p>
          <p className="text-xs mt-1 opacity-70">
            {filter === "en_cours" && "Aucune commande en cours"}
            {filter === "litige" && "Aucun litige en cours"}
            {filter === "terminee" && "Aucune commande terminée"}
          </p>
        </div>
      )}

      {/* Product list */}
      {filter !== "retours" && filter !== "a_commander" && (
        <div className="space-y-2">
          {filtered.map((item) => (
            <ProductCard
              key={`prod-${item.data.id}`}
              item={item}
              estId={estId}
              establishmentNames={establishmentNames}
              ecartMap={ecartMap}
              onViewItem={onViewItem}
              deleteProductDraft={deleteProductDraft}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Stale litiges monitoring banner ── */

function StaleLitigesWarning() {
  const { data: stale } = useStaleLitiges();
  if (!stale || stale.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" />
      <span className="text-red-800 dark:text-red-200">
        <span className="font-medium">{stale.length}</span> litige(s) ouvert(s) &gt; 72h
      </span>
    </div>
  );
}

/* ── Product Card ── */

function ProductCard({
  item,
  estId,
  establishmentNames,
  ecartMap,
  onViewItem,
  deleteProductDraft,
}: {
  item: UnifiedItem;
  estId: string | undefined;
  establishmentNames: Record<string, string>;
  ecartMap: Map<string, { manqueCount: number; surplusCount: number; totalManque: number; totalSurplus: number }>;
  onViewItem: (item: UnifiedItem) => void;
  deleteProductDraft: ReturnType<typeof useDeleteDraftCommande>;
}) {
  const c = item.data;
  const isSender = c.client_establishment_id === estId;
  const partnerName = isSender
    ? establishmentNames[c.supplier_establishment_id] || "Fournisseur"
    : establishmentNames[c.client_establishment_id] || "Client";

  const ecart = ecartMap.get(c.id);
  const createdBy = (item.data as ProductCommandeResolved).created_by_name || c.created_by_name_snapshot || "—";
  const dateStr = c.sent_at ? formatDateTimeParis(c.sent_at) : formatDateTimeParis(c.created_at);

  return (
    <div
      className="flex items-center justify-between p-3.5 rounded-xl border bg-card hover:bg-accent/30 cursor-pointer transition-colors active:scale-[0.99]"
      onClick={() => onViewItem(item)}
    >
      <div className="flex-1 min-w-0 mr-3">
        {/* Partner name */}
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate">{partnerName}</p>
          {c.status === "brouillon" && isSender && (
            <span className="text-[10px] text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded">Brouillon</span>
          )}
        </div>

        {/* Meta line */}
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {c.order_number && (
            <span className="font-mono">{c.order_number} · </span>
          )}
          {dateStr} · {createdBy}
        </p>

        {/* Litige summary */}
        {c.status === "litige" && ecart && (
          <div className="flex items-center gap-1.5 mt-1.5">
            {ecart.manqueCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                <TrendingDown className="h-3 w-3" />
                −{ecart.totalManque}
              </span>
            )}
            {ecart.surplusCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                <TrendingUp className="h-3 w-3" />
                +{ecart.totalSurplus}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Status badge + actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <CommandeStatusBadge status={c.status as CommandeStatus} isSender={isSender} />
        {c.status === "brouillon" && isSender && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (deleteProductDraft.isPending) return;
              deleteProductDraft.mutate(c.id, {
                onSuccess: () => toast.success("Brouillon supprimé"),
                onError: () => toast.error("Erreur"),
              });
            }}
            className="p-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="Supprimer le brouillon"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
