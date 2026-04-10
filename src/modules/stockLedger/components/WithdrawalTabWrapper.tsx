/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WITHDRAWAL TAB WRAPPER — Toggle between Saisir and Historique
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Wraps MobileWithdrawalView and WithdrawalHistoryView with a simple toggle.
 * The saisie flow is 100% untouched — it renders MobileWithdrawalView as-is.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { ChevronLeft, ClipboardList, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileWithdrawalView } from "./MobileWithdrawalView";
import { WithdrawalHistoryView } from "./WithdrawalHistoryView";

type Tab = "saisir" | "historique";

interface Props {
  onBack?: () => void;
}

export function WithdrawalTabWrapper({ onBack }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("saisir");

  return (
    <div className="flex flex-col h-full">
      {/* Header with back + toggle */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="mr-1">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Retour
          </Button>
        )}
        <div className="flex-1" />
        <div className="inline-flex rounded-lg bg-muted p-0.5">
          <button
            onClick={() => setActiveTab("saisir")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "saisir"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            Saisir
          </button>
          <button
            onClick={() => setActiveTab("historique")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "historique"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Historique
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "saisir" ? (
          <MobileWithdrawalView />
        ) : (
          <WithdrawalHistoryView />
        )}
      </div>
    </div>
  );
}
