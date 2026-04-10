/**
 * Inventaire — Coming Soon Placeholder
 */
import { ComingSoonPage } from "@/components/ComingSoonPage";
import { Clipboard } from "lucide-react";

export default function InventairePage() {
  return (
    <ComingSoonPage
      moduleKey="inventaire"
      title="Inventaire"
      description="Suivez votre stock en temps réel."
      icon={Clipboard}
      features={[
        "Inventaire physique assisté",
        "Suivi des écarts",
        "Valorisation automatique",
        "Export comptable",
      ]}
    />
  );
}
