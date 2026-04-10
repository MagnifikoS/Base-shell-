/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE — Page Router (Mobile vs Desktop) + Icon Nav
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Component, useState, lazy, Suspense, type ReactNode } from "react";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Boxes,
  PackageCheck,
  PackageMinus,
  Bell,
  History,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DesktopInventoryView } from "../components/DesktopInventoryView";

import { StockAlertsView } from "@/modules/stockAlerts";
import { BlAppPostPopup } from "@/modules/blApp";
import { InventoryHistoryView } from "@/modules/inventaireHistory";
import { DiscrepancyListView, useOpenDiscrepancyCount } from "@/modules/ecartsInventaire";


const BASE_INVENTORY_TABS = [
  { id: "inventaire", label: "Stock", icon: Boxes },
  { id: "receptions", label: "Réceptions", icon: PackageCheck },
  { id: "retraits", label: "Retraits", icon: PackageMinus },
  
  { id: "ecarts", label: "Écarts", icon: TriangleAlert },
  { id: "alertes", label: "Alertes", icon: Bell },
  { id: "historique", label: "Historique", icon: History },
] as const;

type TabId = (typeof BASE_INVENTORY_TABS)[number]["id"];

/** Error boundary for inventory page tabs */
class InventoryErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  state = { hasError: false, errorMessage: "" };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error.message || "Une erreur est survenue" };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
          <AlertTriangle className="h-12 w-12 text-destructive" />
          <p className="text-lg font-medium text-destructive">Erreur de chargement</p>
          <p className="text-sm text-muted-foreground">{this.state.errorMessage}</p>
          <Button
            variant="outline"
            onClick={() => this.setState({ hasError: false, errorMessage: "" })}
          >
            Réessayer
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Mobile-only components — lazy-loaded (API-PERF-013)
const MobileInventoryView = lazy(() =>
  import("../components/MobileInventoryView").then((m) => ({
    default: m.MobileInventoryView,
  }))
);
const MobileReceptionView = lazy(() =>
  import("@/modules/stockLedger/components/MobileReceptionView").then((m) => ({
    default: m.MobileReceptionView,
  }))
);
const WithdrawalTabWrapper = lazy(() =>
  import("@/modules/stockLedger/components/WithdrawalTabWrapper").then((m) => ({
    default: m.WithdrawalTabWrapper,
  }))
);
const _MobileStockAlertsView = lazy(() =>
  import("@/modules/stockAlerts/components/MobileStockAlertsView").then((m) => ({
    default: m.MobileStockAlertsView,
  }))
);

function TabLoader() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
    </div>
  );
}

function InventoryTabContent({
  activeTab,
  setActiveTab,
  establishmentId,
}: {
  activeTab: TabId;
  setActiveTab: (t: TabId) => void;
  establishmentId: string | undefined;
}) {
  switch (activeTab) {
    case "inventaire":
      return <DesktopInventoryView />;
    case "receptions":
      return (
        <Suspense fallback={<TabLoader />}>
          <MobileReceptionView PostPopup={BlAppPostPopup} />
        </Suspense>
      );
    case "retraits":
      return (
        <Suspense fallback={<TabLoader />}>
          <WithdrawalTabWrapper />
        </Suspense>
      );
    case "ecarts":
      return <DiscrepancyListView />;
    case "alertes":
      return <StockAlertsView />;
    case "historique":
      return <InventoryHistoryView />;
    default:
      return null;
  }
}

export default function InventairePage() {
  const isMobile = useIsMobile();
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;
  const [activeTab, setActiveTab] = useState<TabId>("inventaire");
  const openDiscrepancyCount = useOpenDiscrepancyCount();

  const tabs = BASE_INVENTORY_TABS;

  // Stock realtime is handled centrally by useAppRealtimeSync (useStockEventsChannel)

  return (
    <ResponsiveLayout>
      <InventoryErrorBoundary>
        {isMobile ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            }
          >
            <MobileInventoryView />
          </Suspense>
        ) : (
          <div className="w-full space-y-6">
            {/* Icon navigation bar */}
            <nav className="flex items-center gap-2 p-1.5 bg-card border border-border rounded-xl shadow-sm">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                const badgeCount = tab.id === "ecarts" ? openDiscrepancyCount : 0;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 flex-1 py-3 px-2 rounded-lg transition-all duration-200 group relative",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-md"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <div className="relative">
                      <Icon
                        className={cn(
                          "h-5 w-5 transition-transform duration-200",
                          isActive && "scale-110"
                        )}
                        strokeWidth={isActive ? 2.2 : 1.8}
                      />
                      {badgeCount > 0 && (
                        <span className="absolute -top-1.5 -right-2 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                          {badgeCount}
                        </span>
                      )}
                    </div>
                    <span
                      className={cn(
                        "text-[11px] font-medium leading-tight tracking-wide",
                        isActive && "font-semibold"
                      )}
                    >
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* Tab content */}
            <InventoryTabContent activeTab={activeTab} setActiveTab={setActiveTab} establishmentId={estId} />
          </div>
        )}
      </InventoryErrorBoundary>
    </ResponsiveLayout>
  );
}
