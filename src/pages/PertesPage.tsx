/**
 * Pertes & Casse — Coming Soon Placeholder
 */
import { ComingSoonPage } from "@/components/ComingSoonPage";
import { AlertTriangle } from "lucide-react";

export default function PertesPage() {
  return (
    <ComingSoonPage
      moduleKey="pertes"
      title="Pertes & Casse"
      description="Enregistrez et analysez les pertes et la casse."
      icon={AlertTriangle}
      features={[
        "Déclaration rapide de perte",
        "Catégorisation (casse, péremption, vol)",
        "Analyse des tendances",
        "Rapports mensuels",
      ]}
    />
  );
}
