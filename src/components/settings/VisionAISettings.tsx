/**
 * Vision AI Settings -- extraction engine info + unified units settings
 *
 * Moved from modules/visionAI/components/ to components/settings/ to break
 * circular dependency: visionAI/index -> VisionAISettings -> UnifiedUnitsSettings
 * -> PackagingSection -> visionAI/index.
 *
 * This component has no visionAI module-specific imports, so it belongs here.
 */
import { UnifiedUnitsSettings } from "@/components/settings/UnifiedUnitsSettings";
import { Bot, Sparkles, CheckCircle2 } from "lucide-react";

export function VisionAISettings() {
  return (
    <div className="space-y-6 p-4 max-w-2xl">
      {/* Section 1: Extraction Engine */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Moteur d'extraction</h3>
        <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
          Le moteur d'extraction est le composant IA qui analyse vos documents (factures, bons de
          livraison, releves) et en extrait automatiquement les donnees : fournisseur, produits,
          prix, quantites.
        </p>
        <div className="flex items-start gap-3 p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
          <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center flex-shrink-0">
            <Bot className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">IA avancee</p>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Actif
                </span>
              </div>
            </div>
            <p className="text-sm text-foreground/70">
              Classification automatique du type de document (facture, bon de livraison, releve) et
              extraction des donnees en une seule passe.
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              <Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs text-foreground/60">Auto-classification activee</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Units & Packaging */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Unites et conditionnements</h3>
        <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
          Ces unites definissent comment les produits extraits sont convertis et ranges en stock.
          Elles sont utilisees lors de la correspondance automatique entre les unites du fournisseur
          et vos unites internes.
        </p>
        <UnifiedUnitsSettings />
      </div>
    </div>
  );
}
