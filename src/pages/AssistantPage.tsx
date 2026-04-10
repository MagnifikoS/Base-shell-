/**
 * Assistant IA — Coming Soon Placeholder
 */
import { ComingSoonPage } from "@/components/ComingSoonPage";
import { Bot } from "lucide-react";

export default function AssistantPage() {
  return (
    <ComingSoonPage
      moduleKey="assistant"
      title="Assistant IA"
      description="Votre copilote intelligent pour la gestion."
      icon={Bot}
      features={[
        "Analyse prédictive",
        "Recommandations automatiques",
        "Résumés quotidiens",
        "Alertes intelligentes",
      ]}
    />
  );
}
