/**
 * Vision AI Settings — extraction engine info + unified units settings
 */
import { UnifiedUnitsSettings } from "@/components/settings/UnifiedUnitsSettings";
import { Bot, Sparkles } from "lucide-react";

export function VisionAISettings() {
  return (
    <div className="space-y-6">
      {/* Section 1: Extraction Engine */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Moteur d'extraction</h3>
        <div className="flex items-start gap-3 p-4 rounded-lg bg-card border border-border">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">IA avancee</p>
            <p className="text-xs text-muted-foreground">
              Classification automatique du type de document (facture, bon de livraison, releve) et
              extraction des donnees en une seule passe.
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs text-muted-foreground">Auto-classification activee</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Units & Packaging */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Unites et conditionnements</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Ces unites definissent comment les produits extraits sont convertis et ranges en stock.
        </p>
        <UnifiedUnitsSettings />
      </div>
    </div>
  );
}
